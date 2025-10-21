import { UnauthorizedError } from "../../exceptions";
import { User as IUser, AdminPermission } from "../../modules/users/user.interface";
import User from "../../modules/users/user.model";

/**
 * Flexible permission checker
 * - Supports fallbacks (e.g., view_loans → view_pending → view_overdue)
 * - Supports inherited permissions (e.g., manage_loans includes all loan views)
 */
export function checkPermission(
  admin: IUser | null,
  required: AdminPermission | AdminPermission[],
  { throwOnFail = false }: { throwOnFail?: boolean } = {}
): boolean {
  if (!admin) {
    if (throwOnFail) throw new UnauthorizedError("Unauthorized: No admin context");
    return false;
  }

  if (admin.is_super_admin) return true;

  const permissions = admin.permissions || [];

  // Normalize to array
  const requiredPermissions = Array.isArray(required) ? required : [required];

  // Inheritance map (manage_* implies all view_* in the same category)
  const inheritance: Record<string, AdminPermission[]> = {
    manage_users: ["view_users"],
    manage_loans: ["view_loans", "view_pending", "view_overdue"],
    manage_transactions: ["view_transactions"],
    manage_savings: ["view_savings"],
    manage_bill_payments: ["view_bill_payments"],
    manage_notifications: ["view_notifications", "send_notifications"],
    manage_settings: ["view_reports", "view_profits"],
  };

  // Expand permissions based on inheritance
  const expanded = new Set(permissions);
  for (const perm of permissions) {
    if (inheritance[perm]) {
      inheritance[perm].forEach((child) => expanded.add(child));
    }
  }

  // Check direct match or any fallback
  const hasPermission = requiredPermissions.some((perm) => expanded.has(perm));

  if (!hasPermission && throwOnFail) {
    throw new UnauthorizedError(
      `You do not have permission to perform this action. Required: ${requiredPermissions.join(", ")}`
    );
  }

  return hasPermission;
}

// Admin mails by permission
export async function getMailsByPermission(permission: AdminPermission) {
  let result = "primefinancials68@gmail.com";
  const admins = await User.find({ role: "admin" });

  const selectedAdmins = admins.filter(admin => admin.is_super_admin || (admin.permissions.includes(permission)))

  for(const admin of selectedAdmins){
    if(result)
      result = result+ ", " + admin.email;
    else
      result = result  + admin.email;
  }

  return result;
}