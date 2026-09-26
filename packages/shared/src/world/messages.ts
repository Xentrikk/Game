import { z } from "zod";
import { DIRECTIONS } from "./constants";

/** Client → server messages in world rooms. */
export const moveMessage = z
  .object({
    dir: z.enum(DIRECTIONS),
    run: z.boolean(),
    seq: z
      .number()
      .int()
      .min(1)
      .max(2 ** 31),
  })
  .strict();
export type MoveMessage = z.infer<typeof moveMessage>;

export const faceMessage = z.object({ dir: z.enum(DIRECTIONS) }).strict();
export type FaceMessage = z.infer<typeof faceMessage>;

/** Close code the server uses when the same account joins again elsewhere. */
export const CLOSE_REPLACED = 4001;
