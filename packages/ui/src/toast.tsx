import { Toast } from "@base-ui/react/toast";
import CircleAlert from "kubai-icons-react/icons/circle-alert";
import CircleX from "kubai-icons-react/icons/circle-x";

import { cx } from "./cx";
import { focusRing } from "./focus";
import { Icon } from "./icon";

export const toasts = Toast.createToastManager();

const ToastList = ({ dismissLabel }: { dismissLabel: string }) => {
  const { toasts: list } = Toast.useToastManager();

  return list.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="not-typeset rounded-container bg-surface-3 shadow-surface-4 flex max-w-full items-start gap-3 py-2 pr-2 pl-4 sm:max-w-96"
    >
      <span
        className={cx(
          "flex h-(--size-control) items-center",
          toast.type === "error" ? "text-destructive" : "text-foreground"
        )}
      >
        <Icon glyph={CircleAlert} />
      </span>
      <Toast.Title className="text-body text-foreground min-w-0 flex-1 py-2" />
      <Toast.Close
        aria-label={dismissLabel}
        className={cx(
          "flex size-(--size-control) shrink-0 cursor-pointer items-center justify-center rounded-control text-muted-foreground hover:bg-hover",
          focusRing
        )}
      >
        <Icon glyph={CircleX} size={16} />
      </Toast.Close>
    </Toast.Root>
  ));
};

export const ToastRegion = ({ dismissLabel }: { dismissLabel: string }) => (
  <Toast.Provider toastManager={toasts} timeout={0}>
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 left-4 z-(--z-popup) flex flex-col items-end gap-2 outline-none sm:left-auto">
        <ToastList dismissLabel={dismissLabel} />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
