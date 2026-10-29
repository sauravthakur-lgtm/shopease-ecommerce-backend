import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProductDto } from './dto/create-product.dto';

export const BULK_PRODUCT_UPLOAD_MAX_SIZE = 2 * 1024 * 1024;
export const BULK_PRODUCT_UPLOAD_MAX_ROWS = 500;

const requiredColumns = ['name', 'category', 'price', 'stock'];
const supportedColumns = new Set([
  ...requiredColumns,
  'description',
  'imageUrl',
]);

export interface BulkProductError {
  row: number;
  field: string;
  message: string;
}

export interface BulkProductCandidate {
  row: number;
  values: Record<string, string>;
  dto?: CreateProductDto;
  errors: BulkProductError[];
}

export function parseCsv(buffer: Buffer): string[][] {
  if (buffer.byteLength > BULK_PRODUCT_UPLOAD_MAX_SIZE) {
    throw new BadRequestException('The CSV file exceeds the 2 MiB upload limit.');
  }

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException('The CSV file must contain valid UTF-8 text.');
  }

  if (content.includes('\u0000')) {
    throw new BadRequestException('The CSV file contains unsupported characters.');
  }

  content = content.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  let recordStarted = false;
  const finishRecord = () => {
    if (rows.length >= BULK_PRODUCT_UPLOAD_MAX_ROWS + 1) {
      throw new BadRequestException(
        `The CSV exceeds the limit of ${BULK_PRODUCT_UPLOAD_MAX_ROWS} product rows.`,
      );
    }
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    quoteClosed = false;
    recordStarted = false;
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n') {
      throw new BadRequestException('The CSV file contains malformed quoted fields.');
    }

    if (character === '"') {
      if (field.length > 0 || quoteClosed) {
        throw new BadRequestException('The CSV file contains malformed quoted fields.');
      }
      quoted = true;
      recordStarted = true;
    } else if (character === ',') {
      if (row.length >= supportedColumns.size - 1) {
        throw new BadRequestException('The CSV contains more columns than are supported.');
      }
      row.push(field);
      field = '';
      quoteClosed = false;
      recordStarted = true;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      finishRecord();
    } else {
      field += character;
      recordStarted = true;
    }
  }

  if (quoted) {
    throw new BadRequestException('The CSV file contains an unterminated quoted field.');
  }

  if (recordStarted || row.length > 0 || field.length > 0 || quoteClosed) {
    finishRecord();
  }

  return rows;
}

export function validateProductCsv(buffer: Buffer): BulkProductCandidate[] {
  const rows = parseCsv(buffer);
  if (rows.length < 2) {
    throw new BadRequestException('The CSV must include a header and at least one product row.');
  }

  const headers = rows[0].map((header) => header.trim());
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase('en'));

  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new BadRequestException('The CSV header contains duplicate columns.');
  }

  const unsupportedHeader = headers.find(
    (header) => !supportedColumns.has(header),
  );
  if (unsupportedHeader) {
    throw new BadRequestException(`Unsupported CSV column: ${unsupportedHeader}.`);
  }

  const missingColumns = requiredColumns.filter(
    (column) => !headers.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new BadRequestException(
      `The CSV is missing required columns: ${missingColumns.join(', ')}.`,
    );
  }

  if (rows.length - 1 > BULK_PRODUCT_UPLOAD_MAX_ROWS) {
    throw new BadRequestException(
      `The CSV exceeds the limit of ${BULK_PRODUCT_UPLOAD_MAX_ROWS} product rows.`,
    );
  }

  return rows.slice(1).map((cells, index) => {
    const rowNumber = index + 2;
    const values: Record<string, string> = {};
    const errors: BulkProductError[] = [];

    if (cells.length !== headers.length) {
      errors.push({
        row: rowNumber,
        field: 'row',
        message: `Expected ${headers.length} columns but found ${cells.length}.`,
      });
    }

    headers.forEach((header, columnIndex) => {
      values[header] = cells[columnIndex] ?? '';
    });

    const dto = plainToInstance(CreateProductDto, {
      name: values.name,
      description: values.description || undefined,
      category: values.category,
      price: values.price.trim() ? values.price : undefined,
      stock: values.stock.trim() ? values.stock : undefined,
      imageUrl: values.imageUrl || undefined,
    });

    for (const validationError of validateSync(dto)) {
      for (const message of Object.values(validationError.constraints ?? {})) {
        errors.push({
          row: rowNumber,
          field: validationError.property,
          message,
        });
      }
    }

    return {
      row: rowNumber,
      values,
      dto: errors.length === 0 ? dto : undefined,
      errors,
    };
  });
}
