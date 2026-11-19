export type SpecialistUse = { id: string; label: string };

export type SpecialistDef = {
  id: string;
  label: string;
  group: string;
  instruct: () => string;
  job: string;
  uses: SpecialistUse[];
};

export type ManagerToolCtx = { abortSignal?: AbortSignal; providerId?: string; modelId?: string };
