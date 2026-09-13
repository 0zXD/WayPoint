import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import { useIsTablet } from "@/hooks/use-mobile"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const isTablet = useIsTablet()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={{
        "--mobile-offset": "16px",
        ...(isTablet && {
          width: "calc(100vw - 80px)",
          maxWidth: "320px",
          left: "16px",
          right: "auto",
          bottom: "85px",
        })
      } as React.CSSProperties}
      position={isTablet ? "bottom-left" : "bottom-center"}
      toastOptions={{
        style: {
          background: "var(--toast-bg)",
          backdropFilter: "blur(32px) saturate(180%)",
          WebkitBackdropFilter: "blur(32px) saturate(180%)",
          border: "1px solid var(--toast-border)",
          boxShadow: "var(--toast-shadow)",
          borderRadius: "1.25rem",
          padding: "1.25rem",
          color: "var(--color-foreground)",
          width: "100%",
        },
        classNames: {
          toast:
            "group toast [&_[data-icon]]:hidden [&_[data-content]]:w-full [&_[data-content]]:flex [&_[data-content]]:flex-col [&_[data-content]]:items-center [&_[data-content]]:justify-center text-center",
          title: "font-medium text-sm sm:text-[15px] leading-snug text-center",
          description: "group-[.toast]:text-muted-foreground text-sm text-center",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground !rounded-lg",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground !rounded-lg",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
