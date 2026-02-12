import { describe, expect, it } from "vitest";
import { canAccessPublicLibrary, isProfileDiscoverable } from "@/lib/profilePrivacy";

describe("profile privacy", () => {
  it("only exposes profiles in search when profile is public", () => {
    expect(isProfileDiscoverable({ is_public: true })).toBe(true);
    expect(isProfileDiscoverable({ is_public: false })).toBe(false);
  });

  it("allows public library access for public profiles and owner private access", () => {
    const publicProfile = { user_id: "user-a", is_public: true };
    const privateProfile = { user_id: "user-a", is_public: false };

    expect(canAccessPublicLibrary(null, publicProfile)).toBe(true);
    expect(canAccessPublicLibrary("viewer-b", publicProfile)).toBe(true);
    expect(canAccessPublicLibrary("viewer-b", privateProfile)).toBe(false);
    expect(canAccessPublicLibrary("user-a", privateProfile)).toBe(true);
  });
});

