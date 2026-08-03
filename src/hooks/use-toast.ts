import { toast } from "sonner"

function useToast() {
  return {
    toast,
    dismiss: toast.dismiss,
  }
}

export { useToast, toast }

