"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AVATARS_BUCKET } from "@/lib/supabase/storage";

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function fail(message: string): never {
  redirect(`/account?error=${encodeURIComponent(message)}`);
}

function done(notice: string): never {
  redirect(`/account?notice=${notice}`);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  return { supabase, user };
}

/** Display name and profile picture. Both optional, both saved together. */
export async function updateProfile(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const removeAvatar = formData.get("removeAvatar") === "on";
  const avatar = formData.get("avatar");

  if (!fullName) {
    fail("Your display name can’t be empty.");
  }

  let avatarFile: File | null = null;
  if (avatar instanceof File && avatar.size > 0) {
    if (!(avatar.type in ALLOWED_AVATAR_TYPES)) {
      fail("Your picture must be a JPG, PNG, or WEBP image.");
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      fail("Your picture must be smaller than 4MB.");
    }
    avatarFile = avatar;
  }

  const { supabase, user } = await requireUser();

  const { data: existing } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const oldAvatarPath: string | null = existing?.avatar_url ?? null;
  let avatarPath: string | null = oldAvatarPath;

  if (avatarFile) {
    const ext = ALLOWED_AVATAR_TYPES[avatarFile.type];
    // Keyed by user id, not organization: one picture follows the person
    // across every theatre they belong to.
    avatarPath = `${user.id}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(avatarPath, avatarFile, { contentType: avatarFile.type });

    if (uploadError) {
      fail(`Couldn’t upload your picture: ${uploadError.message}`);
    }
  } else if (removeAvatar) {
    avatarPath = null;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, avatar_url: avatarPath })
    .eq("id", user.id);

  if (error) {
    fail(error.message);
  }

  // Only once the new state is saved, same order as the item photo flow.
  if (oldAvatarPath && oldAvatarPath !== avatarPath) {
    await supabase.storage.from(AVATARS_BUCKET).remove([oldAvatarPath]);
  }

  done("profile-saved");
}

/**
 * Supabase mails a confirmation link (to both addresses, when secure email
 * change is on), so nothing changes until the person clicks it. The page
 * says "check your inbox" rather than reporting it as done.
 */
export async function updateEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    fail("Enter the email address you want to move to.");
  }

  const { supabase, user } = await requireUser();

  if (email.toLowerCase() === (user.email ?? "").toLowerCase()) {
    fail("That’s already your email address.");
  }

  const { error } = await supabase.auth.updateUser({ email });

  if (error) {
    fail(error.message);
  }

  done("email-pending");
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    fail("Your new password must be at least 8 characters.");
  }

  if (password !== confirm) {
    fail("Those two passwords don’t match.");
  }

  const { supabase } = await requireUser();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    fail(error.message);
  }

  done("password-changed");
}

/** Changes which organization every other page in the app is scoped to. */
export async function switchOrganization(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");

  if (!orgId) {
    fail("That request didn’t say which organization to switch to.");
  }

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("switch_organization", {
    p_org_id: orgId,
  });

  if (error) {
    fail(error.message);
  }

  redirect("/items");
}

export async function leaveOrganization(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");

  if (!orgId) {
    fail("That request didn’t say which organization to leave.");
  }

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("leave_organization", {
    p_org_id: orgId,
  });

  if (error) {
    // The most likely one by far is the last-owner guard, which is a real
    // answer rather than a failure, so it reaches the page as written.
    fail(error.message);
  }

  done("left-organization");
}

/** Joins an additional organization without leaving the current one. */
export async function joinOrganization(formData: FormData) {
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  if (!inviteCode) {
    fail("Enter the invite code you were given.");
  }

  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase.rpc("join_organization_with_code", {
    p_invite_code: inviteCode,
    member_name: profile?.full_name ?? user.email ?? "New member",
  });

  if (error) {
    fail(error.message);
  }

  redirect("/items");
}
