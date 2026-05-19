export const PLANS = {
  FREE: 'free',
  BASIC: 'basic',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;

export type PlanKey = keyof typeof PLANS;

export const PLAN_LIMITS: Record<string, { courses: number; downloads: number }> = {
  free:       { courses: 0, downloads: 0 },
  basic:      { courses: 5, downloads: 10 },
  pro:        { courses: Infinity, downloads: Infinity },
  enterprise: { courses: Infinity, downloads: Infinity },
};
