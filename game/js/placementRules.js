/** UI・計算機・探索が共有する配置可否。文字列なら配置不可、nullなら可。 */
export function getPlacementError(cardManager, state, card, staff, placed = state.player.placed) {
    const slot = state.slots.find(slot => slot.id === staff);
    if (!slot) return '配置先がありません';
    const parsed = cardManager.parseEffect(card.effect || '');
    if (parsed.staffRestrictions.length && !parsed.staffRestrictions.includes(staff)) return 'このカードは職種専用です';
    const count = placed[staff]?.length || 0;
    const parallel = parsed.baseEffects.some(effect => effect.type === 'immediate' && effect.effect === 'parallel');
    if (count >= slot.capacity && !(parallel && slot.allowParallel)) return 'このカードは重ね配置できません';
    return state.config.rules.canPlaceCard?.({ state, card, slot, placed }) || null;
}
