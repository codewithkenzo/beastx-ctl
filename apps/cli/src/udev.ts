import { Console, Effect } from "effect";

export const UDEV_RULE =
  'KERNEL=="hidraw*", ATTRS{idVendor}=="36a7", ATTRS{idProduct}=="a887", TAG+="uaccess"';

const INSTALL_LINE =
  "npx beastx udev | sudo tee /etc/udev/rules.d/70-beastx.rules && sudo udevadm control --reload && sudo udevadm trigger";

export const udevCommand = Effect.gen(function* printRule() {
  yield* Console.log(UDEV_RULE);
  yield* Console.error(INSTALL_LINE);
});
