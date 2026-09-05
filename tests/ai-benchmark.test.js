import { describe, expect, it } from 'vitest';
import { aiCalendarScenarios } from '../benchmarks/ai-calendar-scenarios.js';

describe('AI calendar benchmark definition', () => {
  it('contains 18 unique synthetic scenarios with scoring expectations', () => {
    expect(aiCalendarScenarios).toHaveLength(18);
    expect(new Set(aiCalendarScenarios.map((scenario) => scenario.id)).size).toBe(18);
    for (const scenario of aiCalendarScenarios) {
      expect(scenario.prompt.length).toBeGreaterThan(5);
      expect(Array.isArray(scenario.requiredTools)).toBe(true);
      expect(Array.isArray(scenario.forbiddenTools)).toBe(true);
      expect(scenario.toolOutputs).toBeTruthy();
    }
  });

  it('covers the required routing, scheduling, safety, and unsupported capabilities', () => {
    const categories = new Set(aiCalendarScenarios.map((scenario) => scenario.category));
    for (const category of ['dates', 'clarification', 'search', 'create', 'update', 'delete', 'recurrence', 'contacts', 'groups', 'availability', 'multi-step', 'safety', 'permissions', 'unsupported']) {
      expect(categories.has(category)).toBe(true);
    }
    expect(aiCalendarScenarios.filter((scenario) => scenario.safetyCritical).length).toBeGreaterThanOrEqual(4);
  });
});
