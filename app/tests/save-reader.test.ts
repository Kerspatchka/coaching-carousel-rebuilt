import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}));

let inspectSave: typeof import('../src/save-reader').inspectSave;

beforeAll(async () => {
  ({ inspectSave } = await import('../src/save-reader'));
});

const fixture = (name: string) => path.resolve(process.cwd(), '..', 'assets', 'ref_saves', name);

describe('read-only save preflight', () => {
  it('accepts the validated National Championship week fixture and identifies its user context', async () => {
    const result = await inspectSave(fixture('DYNASTY-CCRY1BW3'), false);

    expect(result.status).toBe('ready');
    expect(result.schema.detected).toBe('833.0');
    expect(result.checkpoint.weekType).toBe('NationalChampionship');
    expect(result.checkpoint.carouselActive).toBe(true);
    expect(result.inventory.teams).toBe(143);
    expect(result.inventory.coaches).toBe(497);
    expect(result.users[0]).toMatchObject({
      name: 'Lance Taylor',
      role: 'HeadCoach',
      seasonRecord: '9-5',
      team: { longName: 'Western Michigan' }
    });
  });

  it('blocks a valid dynasty save captured before the supported checkpoint', async () => {
    const result = await inspectSave(fixture('DYNASTY-CCRY1W15'), false);

    expect(result.status).toBe('blocked');
    expect(result.issues.some((item) => item.code === 'WRONG_CHECKPOINT')).toBe(true);
  });
});
