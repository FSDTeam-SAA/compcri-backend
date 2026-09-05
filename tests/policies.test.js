import { describe, expect, it } from 'vitest';
import { DELEGATION_CAPABILITIES } from '../constants/enums.js';

describe('delegation capability presets', () => {
  it.each([
    ['ADD_ONLY', { view: 'OWN', create: true, edit: 'NONE', delete: 'NONE' }],
    ['EDIT_ONLY', { view: 'OWN', create: false, edit: 'OWN', delete: 'NONE' }],
    ['ADD_EDIT', { view: 'OWN', create: true, edit: 'OWN', delete: 'NONE' }],
    ['DELETE_ONLY', { view: 'OWN', create: false, edit: 'NONE', delete: 'OWN' }],
    ['VIEW_EDIT_ALL', { view: 'ALL', create: false, edit: 'ALL', delete: 'NONE' }],
    ['VIEW_OWN', { view: 'OWN', create: false, edit: 'NONE', delete: 'NONE' }],
    ['FULL_ACCESS', { view: 'ALL', create: true, edit: 'ALL', delete: 'ALL' }]
  ])('%s grants only its documented calendar capabilities', (preset, expected) => {
    expect(DELEGATION_CAPABILITIES[preset]).toEqual(expected);
    expect(DELEGATION_CAPABILITIES[preset]).not.toHaveProperty('profile');
    expect(DELEGATION_CAPABILITIES[preset]).not.toHaveProperty('billing');
    expect(DELEGATION_CAPABILITIES[preset]).not.toHaveProperty('account');
  });
});
