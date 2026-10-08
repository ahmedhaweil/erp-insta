import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ImportOptionsDto } from './data-import.dto';

// Same options as the global ValidationPipe (main.ts).
const parse = (body: Record<string, unknown>) =>
  plainToInstance(ImportOptionsDto, body, { enableImplicitConversion: true });

describe('ImportOptionsDto booleans (multipart strings)', () => {
  it.each([
    ['false', false],
    ['0', false],
    ['no', false],
    ['true', true],
    ['1', true],
  ])('"%s" -> %s', (raw, expected) => {
    const dto = parse({ updateExisting: raw, createMissing: raw });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.updateExisting).toBe(expected);
    expect(dto.createMissing).toBe(expected);
  });

  it('leaves omitted flags undefined (service defaults apply)', () => {
    expect(parse({}).updateExisting).toBeUndefined();
  });
});
