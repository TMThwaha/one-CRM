import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, "Organization name is required").max(120),
  industry: z.string().trim().max(60).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const inviteSchema = z.object({
  email: emailSchema,
  roleKey: z.string().trim().min(1).max(40),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  // Strength is validated by the service when a NEW account is created; for an existing
  // account this is just the current password.
  password: z.string().min(1).max(128),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(60).optional(),
});

export const updateMemberSchema = z
  .object({
    roleKey: z.string().trim().min(1).max(40).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => v.roleKey !== undefined || v.status !== undefined, "Nothing to update");

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
export const resetPasswordFormSchema = z.object({ password: passwordSchema });
export type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

/** A 6-digit authenticator code or an `xxxxx-xxxxx` recovery code. */
export const mfaCodeSchema = z.object({ code: z.string().trim().min(6, "Enter your code").max(20) });
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

export const mfaDisableSchema = z.object({
  password: z.string().min(1, "Password is required").max(128),
  code: z.string().trim().min(6, "Enter your code").max(20),
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const roleInputSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).nullish().transform((v) => (v ? v : null)),
  /** permission key -> "all" | "own"; the server validates keys, scopes and dependencies. */
  permissions: z.record(z.string(), z.string()),
});
export type RoleInput = z.input<typeof roleInputSchema>;
