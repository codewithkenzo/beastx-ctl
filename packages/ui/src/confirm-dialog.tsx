import { AlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  labels: { title: string; confirm: string; cancel: string };
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  onConfirm,
  labels,
}: ConfirmDialogProps) => (
  <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="bg-tint fixed inset-0 z-(--z-popup)" />
      <AlertDialog.Viewport className="fixed inset-0 z-(--z-popup) flex items-center justify-center p-4">
        <AlertDialog.Popup className="not-typeset rounded-container bg-surface-3 shadow-surface-6 flex w-full max-w-96 flex-col gap-6 p-6 outline-none">
          <AlertDialog.Title className="text-subtitle text-foreground">
            {labels.title}
          </AlertDialog.Title>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close render={<Button />}>
              {labels.cancel}
            </AlertDialog.Close>
            <Button
              variant="primary"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {labels.confirm}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Viewport>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
