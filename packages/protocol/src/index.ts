export { crc16Modbus } from "./crc";

export {
  CONFIG_LEN,
  DEBOUNCE_MAX,
  HIGH_MODE,
  PROFILE_STRIDE,
  STAGE_COUNT,
  profileError,
} from "./blocks";

export {
  Battery,
  ConfigBlock,
  DisplayBlock,
  Settings,
  decodeActiveProfile,
  decodeBatteryReply,
  decodeConfigBlock,
  decodeDisplayBlock,
  decodeSettingsBlock,
  decodeStages,
  DpiStage,
} from "./blocks";

export {
  BadReportId,
  ChecksumMismatch,
  DeviceStatus,
  FrameLength,
  OutOfRange,
  UnsupportedCommand,
  UnsupportedValue,
} from "./errors";

export type { FrameError } from "./errors";

export { Command } from "./frame";

export {
  activeStageFromChunk,
  assembleConfig,
  pingFrame,
  readActiveProfileFrame,
  readBatteryFrame,
  readConfigChunkFrame,
  readConfigFrames,
  readDisplayFrame,
  stageXChunkStart,
  stageXFromChunk,
} from "./read";

export { ReplyFrame, decodeReplyFrame } from "./reply";

export { writeConfigPatch, writeDisplayFrame } from "./write";

export type { DisplayPatch, SettingsPatch, StagePatch } from "./write";
