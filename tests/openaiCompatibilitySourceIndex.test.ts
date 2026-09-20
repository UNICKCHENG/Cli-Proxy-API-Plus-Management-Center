import { describe, expect, test } from 'bun:test';
import { openaiToResource } from '../src/features/providers/adapters';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('openai-compatibility source indexes', () => {
  test('keeps backend indexes when normalization filters an unnamed item', () => {
    const config = normalizeConfigResponse({
      'openai-compatibility': [
        { 'base-url': 'https://invalid.example.com/v1' },
        {
          name: 'Gateway',
          'base-url': 'https://official.example.com/v1',
          'api-key-entries': [{ 'api-key': 'official-a' }],
        },
        {
          name: 'Gateway',
          'base-url': 'https://gateway.example.com/v1',
          'api-key-entries': [{ 'api-key': 'custom-key' }],
        },
        {
          name: 'Gateway',
          'base-url': 'https://official.example.com/v1',
          'api-key-entries': [{ 'api-key': 'official-b' }],
        },
      ],
    });

    expect(config.openaiCompatibility?.map((item) => item.sourceIndex)).toEqual([1, 2, 3]);
    expect(openaiToResource(config.openaiCompatibility![1], 1).originalIndex).toBe(2);
  });
});
