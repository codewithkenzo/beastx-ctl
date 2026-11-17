import { Result, Schema } from "effect";

import { crc16Modbus } from "./crc";
import {
  BadReportId,
  ChecksumMismatch,
  DeviceStatus,
  FrameLength,
} from "./errors";
import type { FrameError } from "./errors";
import {
  Command,
  CRC_END,
  CRC_START,
  DATA_OFFSET,
  FRAME_LEN,
  REPORT_ID,
} from "./frame";

export const ReplyFrame = Schema.Struct({
  cmd: Schema.Int,
  data: Schema.Uint8Array,
  status: Schema.Int,
});

const LENGTH_OFFSET = 4;

const STATUS_ERRORS: ReadonlySet<number> = new Set([0xff, 0xfe]);

const UNCHECKED_CRC_REPLIES: ReadonlySet<number> = new Set([
  Command.Ping,
  Command.Battery,
  Command.ReadDisplay,
]);

const PING_READY_LENGTH = 1;

const requestedLength = (request: Uint8Array): number =>
  request[3] === Command.Ping
    ? PING_READY_LENGTH
    : (request[LENGTH_OFFSET] ?? 0);

export const decodeReplyFrame = (
  bytes: Uint8Array,
  request: Uint8Array
): Result.Result<typeof ReplyFrame.Type, FrameError | Schema.SchemaError> => {
  if (bytes.length !== FRAME_LEN) {
    return Result.fail(
      new FrameLength({ actual: bytes.length, expected: FRAME_LEN })
    );
  }

  if (request.length !== FRAME_LEN) {
    return Result.fail(
      new FrameLength({ actual: request.length, expected: FRAME_LEN })
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reportId = view.getUint8(0);

  if (reportId !== REPORT_ID) {
    return Result.fail(new BadReportId({ actual: reportId }));
  }

  const cmd = view.getUint8(3);

  if (!UNCHECKED_CRC_REPLIES.has(cmd)) {
    const expectedHigh = Math.floor(
      crc16Modbus(bytes.subarray(CRC_START, CRC_END)) / 256
    );

    const highByte = view.getUint8(2);

    if (highByte !== expectedHigh) {
      return Result.fail(
        new ChecksumMismatch({ actual: highByte, expected: expectedHigh })
      );
    }
  }

  const status = view.getUint8(7);

  if (STATUS_ERRORS.has(status)) {
    return Result.fail(new DeviceStatus({ cmd, status }));
  }

  return Schema.decodeResult(ReplyFrame)({
    cmd,
    data: bytes.slice(DATA_OFFSET, DATA_OFFSET + requestedLength(request)),
    status,
  });
};
