import { getStateCallbacks } from "@colyseus/sdk";
import {
  DIR_VECTORS,
  TILE,
  VIEW_H,
  VIEW_W,
  appearanceSchema,
  dirFromIndex,
  dirIndex,
  interactionAt,
  parseMap,
  stepMs,
  tryStep,
  type Dir,
  type Npc,
  type PlayerState,
  type TiledMap,
  type WorldMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json";
import Phaser from "phaser";
import { FRAME_H, WALK_CYCLE } from "../sprites/format";
import { avatarTexture, frameName, nameTagTexture, npcAppearance } from "./avatars";
import { tintForHour } from "./daynight";
import type { InputState } from "./input";
import type { TownRoom } from "./net";
import { ScreenPipeline, hexToUnitRgb } from "./pocket";

/** From a standstill, a tap shorter than this only turns the player. */
const TURN_GRACE_MS = 90;
const DEPTH_CHARACTERS = 10;
const DEPTH_OVERHEAD = 100_000;
const DEPTH_TINT = 150_000;
const DEPTH_TAGS = 200_000;
const TAG_COLOR = "#f4f4f0";
const SELF_TAG_COLOR = "#f4d04a";

export interface WorldUi {
  input: InputState;
  isDialogueOpen(): boolean;
  openDialogue(pages: string[], speaker?: string): void;
  advanceDialogue(): void;
}

export interface WorldSceneData {
  room: TownRoom;
  ui: WorldUi;
  pocket: boolean;
  /** Dev/testing override for the day/night tint. */
  hourOverride?: number;
}

interface Avatar {
  sprite: Phaser.GameObjects.Sprite;
  tag?: Phaser.GameObjects.Image;
  texture?: string;
  tile: { x: number; y: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  duration: number;
  dir: Dir;
  /** Alternates each step so feet alternate. */
  parity: number;
}

interface LocalPlayer {
  avatar: Avatar;
  seq: number;
  pending: { seq: number; dir: Dir; run: boolean }[];
  moving: boolean;
  /** True while walking continuously, so turning mid-walk doesn't pause. */
  walking: boolean;
  lastFaceSent: Dir;
}

const pixelPos = (tile: { x: number; y: number }) => ({
  x: tile.x * TILE,
  y: tile.y * TILE + TILE - FRAME_H,
});

export class WorldScene extends Phaser.Scene {
  private room!: TownRoom;
  private ui!: WorldUi;
  private map!: WorldMap;
  private self?: LocalPlayer;
  private others = new Map<string, Avatar>();
  private npcs = new Map<string, Avatar>();
  /** Multiply overlay for the day/night tint, used only without WebGL (Canvas renderer). */
  private tint!: Phaser.GameObjects.Rectangle;
  private tintColor = 0xffffff;
  private screenFx?: ScreenPipeline;
  private pocket = false;
  private hourOverride?: number;
  private keys: { key: Phaser.Input.Keyboard.Key; dir?: Dir; action?: "a" | "b" | "shift" }[] = [];

  constructor() {
    super("world");
  }

  init(data: WorldSceneData) {
    this.room = data.room;
    this.ui = data.ui;
    this.pocket = data.pocket;
    this.hourOverride = data.hourOverride;
    this.map = parseMap(town as TiledMap);
  }

  preload() {
    this.load.image("town-tiles", `${import.meta.env.BASE_URL}tiles/town.png`);
    this.cache.tilemap.add("town", { format: Phaser.Tilemaps.Formats.TILED_JSON, data: town });
  }

  create() {
    const tilemap = this.make.tilemap({ key: "town" });
    const tileset = tilemap.addTilesetImage("town", "town-tiles")!;
    tilemap.createLayer("ground", tileset)!.setDepth(0);
    tilemap.createLayer("decor", tileset)!.setDepth(1);
    tilemap.createLayer("overhead", tileset)!.setDepth(DEPTH_OVERHEAD);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.map.width * TILE, this.map.height * TILE);
    camera.setRoundPixels(true);

    this.tint = this.add
      .rectangle(0, 0, VIEW_W, VIEW_H, 0xffffff)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH_TINT)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setVisible(false);
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      camera.setPostPipeline(ScreenPipeline);
      this.screenFx = camera.getPostPipeline(ScreenPipeline) as ScreenPipeline;
    }
    this.updateTint();
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.updateTint() });
    this.setPocket(this.pocket);

    for (const npc of this.map.npcs) void this.addNpc(npc);
    this.bindKeyboard();
    this.bindRoom();
  }

  // ---------- Public controls (used by the React screen and debug hooks) ----------

  /** Pocket mode needs WebGL; on the Canvas renderer the setting is kept but has no effect. */
  setPocket(enabled: boolean) {
    this.pocket = enabled;
    if (this.screenFx) this.screenFx.pocket = enabled;
  }

  setHourOverride(hour: number | undefined) {
    this.hourOverride = hour;
    this.updateTint();
  }

  snapshot() {
    const s = this.self;
    return {
      self: s
        ? {
            ...s.avatar.tile,
            dir: s.avatar.dir,
            seq: s.seq,
            px: { x: s.avatar.sprite.x, y: s.avatar.sprite.y },
          }
        : null,
      others: [...this.others.entries()].map(([id, a]) => ({
        id,
        handle: this.room.state.players.get(id)?.handle,
        ...a.tile,
        dir: a.dir,
        px: { x: a.sprite.x, y: a.sprite.y },
      })),
      /** Raw positions from the room state, as opposed to what's drawn. */
      server: [...this.room.state.players.entries()].map(([id, p]) => ({
        id,
        handle: p.handle,
        x: p.x,
        y: p.y,
      })),
      pocket: !!this.screenFx?.pocket,
      tint: this.tintColor,
      fps: this.game.loop.actualFps,
    };
  }

  // ---------- Setup ----------

  private bindKeyboard() {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const bind: [number, Dir | "a" | "b" | "shift"][] = [
      [K.UP, "up"],
      [K.W, "up"],
      [K.DOWN, "down"],
      [K.S, "down"],
      [K.LEFT, "left"],
      [K.A, "left"],
      [K.RIGHT, "right"],
      [K.D, "right"],
      [K.Z, "a"],
      [K.ENTER, "a"],
      [K.SPACE, "a"],
      [K.X, "b"],
      [K.SHIFT, "shift"],
    ];
    for (const [code, what] of bind) {
      // Don't capture keys, so typing in React inputs elsewhere on the page still works.
      const key = kb.addKey(code, false);
      const isAction = what === "a" || what === "b" || what === "shift";
      this.keys.push({ key, dir: isAction ? undefined : what, action: isAction ? what : undefined });
      key.on("down", () => {
        if (!isAction) this.ui.input.press(what);
        else if (what === "a") this.ui.input.pressA();
        else if (what === "b") this.ui.input.runToggle = !this.ui.input.runToggle;
        else this.ui.input.runHeld = true;
      });
      key.on("up", () => {
        if (!isAction) this.ui.input.release(what);
        else if (what === "shift") this.ui.input.runHeld = false;
      });
    }
    this.game.events.on(Phaser.Core.Events.BLUR, () => this.ui.input.releaseAll());
  }

  private bindRoom() {
    const $ = getStateCallbacks(this.room);
    const players = $(this.room.state).players;
    players.onAdd((p: PlayerState, id: string) => {
      if (id === this.room.sessionId) void this.addSelf(p);
      else void this.addOther(id, p);
      $(p).onChange(() => (id === this.room.sessionId ? this.reconcile(p) : this.moveOther(id, p)));
    });
    players.onRemove((_p: PlayerState, id: string) => {
      const a = this.others.get(id);
      a?.sprite.destroy();
      a?.tag?.destroy();
      this.others.delete(id);
    });
  }

  private makeAvatar(tile: { x: number; y: number }, dir: Dir): Avatar {
    const pos = pixelPos(tile);
    const sprite = this.add.sprite(pos.x, pos.y, "__DEFAULT").setOrigin(0).setVisible(false);
    return { sprite, tile: { ...tile }, from: pos, to: pos, start: 0, duration: 0, dir, parity: 0 };
  }

  private async dress(
    avatar: Avatar,
    appearanceJson: unknown,
    name?: string,
    handle?: string,
    tagColor = TAG_COLOR,
  ) {
    const appearance = appearanceSchema.safeParse(appearanceJson);
    if (!appearance.success) return;
    avatar.texture = await avatarTexture(this, appearance.data);
    if (!avatar.sprite.active) return;
    avatar.sprite.setTexture(avatar.texture, frameName(dirIndex(avatar.dir), 0)).setVisible(true);
    if (name !== undefined && handle !== undefined) {
      avatar.tag = this.add
        .image(0, 0, nameTagTexture(this, name, handle, tagColor))
        .setOrigin(0)
        .setDepth(DEPTH_TAGS);
    }
  }

  private async addSelf(p: PlayerState) {
    const avatar = this.makeAvatar({ x: p.x, y: p.y }, dirFromIndex(p.dir));
    this.self = {
      avatar,
      seq: p.seq ?? 0,
      pending: [],
      moving: false,
      walking: false,
      lastFaceSent: avatar.dir,
    };
    this.cameras.main.startFollow(avatar.sprite, true, 1, 1, -TILE / 2, -FRAME_H / 2);
    await this.dress(avatar, JSON.parse(p.appearance), p.name, p.handle, SELF_TAG_COLOR);
  }

  private async addOther(id: string, p: PlayerState) {
    const avatar = this.makeAvatar({ x: p.x, y: p.y }, dirFromIndex(p.dir));
    this.others.set(id, avatar);
    await this.dress(avatar, JSON.parse(p.appearance), p.name, p.handle);
  }

  private async addNpc(npc: Npc) {
    const avatar = this.makeAvatar(npc, npc.dir);
    this.npcs.set(npc.id, avatar);
    await this.dress(avatar, npcAppearance(npc.seed));
  }

  private updateTint() {
    const hour = this.hourOverride ?? new Date().getHours();
    this.tintColor = tintForHour(hour);
    if (this.screenFx) this.screenFx.tint = hexToUnitRgb(this.tintColor);
    else this.tint.setFillStyle(this.tintColor).setVisible(this.tintColor !== 0xffffff);
  }

  // ---------- Movement ----------

  private startStep(a: Avatar, to: { x: number; y: number }, run: boolean, now: number) {
    a.from = { x: a.sprite.x, y: a.sprite.y };
    a.to = pixelPos(to);
    a.tile = { ...to };
    a.start = now;
    a.duration = stepMs(run);
  }

  private snap(a: Avatar, tile: { x: number; y: number }) {
    a.tile = { ...tile };
    a.from = a.to = pixelPos(tile);
    a.duration = 0;
  }

  /** Server state for our own player arrived: drop acknowledged steps and replay the rest. */
  private reconcile(p: PlayerState) {
    const self = this.self;
    if (!self) return;
    self.pending = self.pending.filter((s) => s.seq > p.seq);
    let pos = { x: p.x, y: p.y };
    for (const s of self.pending) pos = tryStep(this.map, pos.x, pos.y, s.dir) ?? pos;
    if (pos.x !== self.avatar.tile.x || pos.y !== self.avatar.tile.y) {
      this.snap(self.avatar, pos);
      self.moving = false;
      self.walking = false;
    }
  }

  private moveOther(id: string, p: PlayerState) {
    const a = this.others.get(id);
    if (!a) return;
    // Players whose connection dropped are shown faded while the server holds their spot.
    const alpha = p.connected === false ? 0.45 : 1;
    a.sprite.setAlpha(alpha);
    a.tag?.setAlpha(alpha);
    a.dir = dirFromIndex(p.dir);
    const dist = Math.abs(p.x - a.tile.x) + Math.abs(p.y - a.tile.y);
    if (dist === 1) {
      a.parity ^= 1;
      this.startStep(a, { x: p.x, y: p.y }, p.run, performance.now());
    } else if (dist > 1) this.snap(a, { x: p.x, y: p.y });
  }

  private tryWalk(dir: Dir, now: number) {
    const self = this.self!;
    const a = self.avatar;
    a.dir = dir;
    const next = tryStep(this.map, a.tile.x, a.tile.y, dir);
    if (!next) {
      self.walking = false;
      this.sendFace(dir);
      return;
    }
    const run = this.ui.input.running;
    const seq = ++self.seq;
    self.pending.push({ seq, dir, run });
    self.lastFaceSent = dir;
    this.room.send("move", { dir, run, seq });
    a.parity ^= 1;
    this.startStep(a, next, run, now);
    self.moving = true;
  }

  private sendFace(dir: Dir) {
    const self = this.self!;
    if (self.lastFaceSent === dir) return;
    self.lastFaceSent = dir;
    this.room.send("face", { dir });
  }

  private interact() {
    const self = this.self!;
    const { x, y } = self.avatar.tile;
    const target = interactionAt(this.map, x, y, self.avatar.dir);
    if (!target) return;
    if ("id" in target) {
      // NPCs turn to face you.
      const npc = this.npcs.get(target.id);
      const [dx, dy] = DIR_VECTORS[self.avatar.dir];
      const facing = (Object.entries(DIR_VECTORS).find(([, v]) => v[0] === -dx && v[1] === -dy)?.[0] ??
        "down") as Dir;
      if (npc) npc.dir = facing;
      this.ui.openDialogue(target.pages, target.name);
    } else {
      this.ui.openDialogue(target.pages);
    }
  }

  override update() {
    const now = performance.now();
    const input = this.ui.input;
    const self = this.self;

    if (self) {
      if (input.consumeA()) {
        if (this.ui.isDialogueOpen()) this.ui.advanceDialogue();
        else if (!self.moving) this.interact();
      }
      if (self.moving && now - self.avatar.start >= self.avatar.duration) self.moving = false;
      if (!self.moving && !this.ui.isDialogueOpen()) {
        const dir = input.current();
        if (!dir) self.walking = false;
        else if (dir !== self.avatar.dir && !self.walking && input.heldFor(dir, now) < TURN_GRACE_MS) {
          self.avatar.dir = dir;
          this.sendFace(dir);
        } else {
          this.tryWalk(dir, now);
          if (self.moving) self.walking = true;
        }
      }
    }

    for (const a of this.allAvatars()) this.draw(a, now);
  }

  private *allAvatars(): Iterable<Avatar> {
    if (this.self) yield this.self.avatar;
    yield* this.others.values();
    yield* this.npcs.values();
  }

  private draw(a: Avatar, now: number) {
    const t = a.duration ? Math.min(1, (now - a.start) / a.duration) : 1;
    const x = Math.round(a.from.x + (a.to.x - a.from.x) * t);
    const y = Math.round(a.from.y + (a.to.y - a.from.y) * t);
    a.sprite.setPosition(x, y).setDepth(DEPTH_CHARACTERS + y + FRAME_H);
    const col = t < 1 ? WALK_CYCLE[a.parity * 2 + (t < 0.5 ? 0 : 1)]! : 0;
    if (a.texture) a.sprite.setFrame(frameName(dirIndex(a.dir), col));
    if (a.tag) a.tag.setPosition(Math.round(x + TILE / 2 - a.tag.width / 2), y - a.tag.height - 1);
  }
}
