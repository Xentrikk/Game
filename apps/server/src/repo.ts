import type { Appearance, ProfileDetails } from "@hearth/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface PersonalData {
  ageVerifiedAt: string | null;
  ageBlockedAt: string | null;
  termsAcceptedAt: string | null;
}

export interface Profile {
  handle: string;
  displayName: string;
  pronouns: string;
  bio: string;
}

export class HandleTakenError extends Error {}

/** Database access for the server. Uses the service role, so every method must be scoped to a user ID. */
export interface Repo {
  getPersonal(userId: string): Promise<PersonalData | null>;
  markAgeVerified(userId: string, dob: string): Promise<void>;
  markAgeBlocked(userId: string): Promise<void>;
  acceptTerms(userId: string, tosVersion: string, privacyVersion: string): Promise<void>;
  getProfile(userId: string): Promise<Profile | null>;
  handleTaken(handle: string): Promise<boolean>;
  /** Throws HandleTakenError if someone else has it. */
  createProfile(userId: string, handle: string): Promise<void>;
  saveCharacter(userId: string, details: ProfileDetails, appearance: Appearance): Promise<void>;
  getAppearance(userId: string): Promise<Appearance | null>;
}

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async getPersonal(userId: string) {
    const { data, error } = await this.db
      .from("personal_data")
      .select("age_verified_at, age_blocked_at, terms_accepted_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ageVerifiedAt: data.age_verified_at,
      ageBlockedAt: data.age_blocked_at,
      termsAcceptedAt: data.terms_accepted_at,
    };
  }

  async markAgeVerified(userId: string, dob: string) {
    const { error } = await this.db
      .from("personal_data")
      .upsert({ user_id: userId, dob, age_verified_at: new Date().toISOString() });
    if (error) throw error;
  }

  async markAgeBlocked(userId: string) {
    const { error } = await this.db.from("personal_data").upsert({
      user_id: userId,
      dob: null,
      age_verified_at: null,
      age_blocked_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async acceptTerms(userId: string, tosVersion: string, privacyVersion: string) {
    const { error } = await this.db
      .from("personal_data")
      .update({
        tos_version: tosVersion,
        privacy_version: privacyVersion,
        terms_accepted_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) throw error;
  }

  async getProfile(userId: string) {
    const { data, error } = await this.db
      .from("profiles")
      .select("handle, display_name, pronouns, bio")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { handle: data.handle, displayName: data.display_name, pronouns: data.pronouns, bio: data.bio };
  }

  async handleTaken(handle: string) {
    const { count, error } = await this.db
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("handle", handle);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async createProfile(userId: string, handle: string) {
    const { error } = await this.db
      .from("profiles")
      .insert({ user_id: userId, handle, display_name: handle });
    if (error?.code === "23505") throw new HandleTakenError();
    if (error) throw error;
  }

  async saveCharacter(userId: string, details: ProfileDetails, appearance: Appearance) {
    const { error } = await this.db.rpc("save_character", {
      p_user_id: userId,
      p_display_name: details.displayName,
      p_pronouns: details.pronouns,
      p_bio: details.bio,
      p_appearance: appearance,
    });
    if (error) throw error;
  }

  async getAppearance(userId: string) {
    const { data, error } = await this.db
      .from("appearances")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.data as Appearance | undefined) ?? null;
  }
}
