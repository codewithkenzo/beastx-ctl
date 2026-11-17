/* oxlint-disable eslint/no-bitwise */
const POLYNOMIAL = 0xa0_01;
const INITIAL = 0xff_ff;

const shiftBit = (crc: number): number =>
  crc & 1 ? (crc >>> 1) ^ POLYNOMIAL : crc >>> 1;

const shiftByte = (crc: number, byte: number): number => {
  let next = crc ^ byte;

  for (let bit = 0; bit < 8; bit += 1) {
    next = shiftBit(next);
  }

  return next;
};

export const crc16Modbus = (bytes: Uint8Array): number => {
  let crc = INITIAL;

  for (const byte of bytes) {
    crc = shiftByte(crc, byte);
  }

  return crc;
};
