export interface RectLike {
  top: number
  bottom: number
}

export interface DropdownPlacement {
  dropUp: boolean
  maxHeight: number
}

export function computeDropdownPlacement(
  trigger: RectLike,
  bounds: RectLike,
  preferredHeight: number,
  gap = 4,
  margin = 8,
): DropdownPlacement {
  const spaceBelow = bounds.bottom - trigger.bottom - gap - margin
  const spaceAbove = trigger.top - bounds.top - gap - margin

  if (spaceBelow >= preferredHeight) {
    return { dropUp: false, maxHeight: preferredHeight }
  }

  const dropUp = spaceAbove > spaceBelow
  const availableSpace = dropUp ? spaceAbove : spaceBelow

  // No positive floor: forcing one could make the menu clip outside its bounds.
  return { dropUp, maxHeight: Math.max(0, Math.min(preferredHeight, availableSpace)) }
}
