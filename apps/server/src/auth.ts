import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./errors";

export interface AuthedUser {
  id: string;
  jwt: string;
}

/** Verifies a Supabase access token and returns the user ID. */
export type TokenVerifier = (jwt: string) => Promise<string>;

export function supabaseTokenVerifier(supabaseUrl: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return async (jwt) => {
    const { payload } = await jwtVerify(jwt, jwks, { audience: "authenticated" });
    if (!payload.sub) throw new Error("token has no subject");
    return payload.sub;
  };
}

const users = new WeakMap<Request, AuthedUser>();

export function requireUser(verify: TokenVerifier) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const jwt = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!jwt) return next(new HttpError(401, "unauthenticated", "Please sign in."));
    try {
      users.set(req, { id: await verify(jwt), jwt });
      next();
    } catch {
      next(new HttpError(401, "unauthenticated", "Your session has expired. Please sign in again."));
    }
  };
}

export function currentUser(req: Request): AuthedUser {
  const user = users.get(req);
  if (!user) throw new HttpError(401, "unauthenticated", "Please sign in.");
  return user;
}
