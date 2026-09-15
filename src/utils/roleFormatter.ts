/**
 * Utility functions for formatting and normalizing Discord role mentions.
 */

/**
 * Normalizes a Role object or role string for persistent storage.
 * - If role is '@everyone' or has the Guild ID (Discord's @everyone role ID), stores 'everyone'.
 * - If role is '@here', stores 'here'.
 * - Otherwise stores the snowflake role ID.
 */
export function normalizeRoleId(
  role: { id: string; name?: string } | string,
  guildId?: string | null
): string {
  if (typeof role === 'string') {
    const trimmed = role.trim();
    if (trimmed === 'everyone' || trimmed === '@everyone' || (guildId && trimmed === guildId)) {
      return 'everyone';
    }
    if (trimmed === 'here' || trimmed === '@here') {
      return 'here';
    }
    return trimmed;
  }

  if (role.name === '@everyone' || (guildId && role.id === guildId)) {
    return 'everyone';
  }
  if (role.name === '@here') {
    return 'here';
  }
  return role.id;
}

/**
 * Formats a roleId string into the correct Discord mention format:
 * - 'everyone' / '@everyone' -> '@everyone'
 * - 'here' / '@here' -> '@here'
 * - Custom role snowflake ID -> '<@&roleId>'
 * - Empty/undefined -> ''
 */
export function formatRoleMention(roleId?: string, guildId?: string | null): string {
  if (!roleId) return '';
  const trimmed = roleId.trim();
  if (trimmed === 'everyone' || trimmed === '@everyone') {
    return '@everyone';
  }
  if (trimmed === 'here' || trimmed === '@here') {
    return '@here';
  }
  if (guildId && trimmed === guildId) {
    return '@everyone';
  }
  return `<@&${trimmed}>`;
}
