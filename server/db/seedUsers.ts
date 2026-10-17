export type SeedUser = {
  username: string;
  name: string;
  isAdmin: boolean;
  passwordEnv: string;
};

export const SEED_USERS: readonly SeedUser[] = [
  { username: 'Todd', name: 'Todd Kennedy', isAdmin: true, passwordEnv: 'SEED_TODD_PASSWORD' },
  { username: 'Isaac', name: 'Isaac Klick', isAdmin: false, passwordEnv: 'SEED_ISAAC_PASSWORD' },
  { username: 'Rob', name: 'Robert Copp', isAdmin: false, passwordEnv: 'SEED_ROB_PASSWORD' },
];

// Returns the env value only when it is set and not blank. No default password.
export function seedPasswordFromEnv(env: NodeJS.ProcessEnv, passwordEnv: string): string | undefined {
  const value = env[passwordEnv];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value;
}
