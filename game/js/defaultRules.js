/** 既存モードの値。追加モードは難易度設定から上書きする。 */
export const DEFAULT_SLOTS = [
    { id: 'leader', name: '室長', capacity: 1, allowParallel: true, persistent: false },
    { id: 'teacher', name: '講師', capacity: 1, allowParallel: true, persistent: false },
    { id: 'staff', name: '事務', capacity: 1, allowParallel: true, persistent: false }
];

export const DEFAULT_TURNS = [
    { name: '1月下旬', week: '1月下旬', training: 'R', recommended: '動員', recommendedStatus: 'experience', delete: 1 },
    { name: '2月上旬', week: '2月上旬', training: 'SR', recommended: '応対', recommendedStatus: 'satisfaction', delete: 1 },
    { name: '2月下旬', week: '2月下旬', training: 'SSR', recommended: '動員', recommendedStatus: 'experience', delete: 1 },
    { name: '3月上旬', week: '3月上旬', training: 'R', recommended: '庶務', recommendedStatus: 'accounting', delete: 1 },
    { name: '3月下旬', week: '3月下旬', training: 'SSR', recommended: '教務', recommendedStatus: 'enrollment', delete: 0 },
    { name: '4月上旬', week: '4月上旬', training: 'SR', recommended: '応対', recommendedStatus: 'satisfaction', delete: 0 },
    { name: '4月下旬', week: '4月下旬', training: 'SR', recommended: '教務', recommendedStatus: 'enrollment', delete: 0 },
    { name: '5月上旬', week: '5月上旬', training: 'SR', recommended: '庶務', recommendedStatus: 'accounting', delete: 0 }
];

export function makeRunId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
