import type { SprintCapacityData, AssigneeSuggestion } from "@/types/devops";

/**
 * Compute assignee suggestions sorted by available capacity for a given activity.
 * Falls back to alphabetical order when no capacity data.
 */
export function computeAssigneeSuggestions(
  capacity: SprintCapacityData | null,
  activity: string,
  allAssignees: string[]
): AssigneeSuggestion[] {
  if (!capacity || capacity.members.length === 0) {
    return allAssignees.map((name) => ({
      displayName: name,
      availableHours: 0,
      capacityPercent: 0,
      isSuggested: false,
    }));
  }

  const capacityMap = new Map(capacity.members.map((m) => [m.displayName, m]));

  const suggestions: AssigneeSuggestion[] = allAssignees.map((name) => {
    const member = capacityMap.get(name);
    if (!member) {
      return { displayName: name, availableHours: 0, capacityPercent: 0, isSuggested: false };
    }

    // Find the specific activity capacity
    const activityData = member.activities.find((a) => a.name === activity);
    const availableHours = activityData
      ? Math.round((activityData.capacityHours - activityData.assignedHours) * 10) / 10
      : Math.round((member.totalCapacity - member.totalAssigned) * 10) / 10;

    const capacityPercent = member.totalCapacity > 0
      ? Math.round((member.totalAssigned / member.totalCapacity) * 100)
      : 0;

    return { displayName: name, availableHours, capacityPercent, isSuggested: false };
  });

  // Sort: members with capacity data first (by most available hours), then others alphabetically
  suggestions.sort((a, b) => {
    const aHasCap = capacityMap.has(a.displayName);
    const bHasCap = capacityMap.has(b.displayName);
    if (aHasCap && !bHasCap) return -1;
    if (!aHasCap && bHasCap) return 1;
    if (aHasCap && bHasCap) return b.availableHours - a.availableHours;
    return a.displayName.localeCompare(b.displayName);
  });

  // Mark top suggestion (most available hours, must have > 0)
  if (suggestions.length > 0 && suggestions[0].availableHours > 0) {
    suggestions[0].isSuggested = true;
  }

  return suggestions;
}
