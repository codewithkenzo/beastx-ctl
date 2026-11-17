import { focusRing, Icon, RadioMenu } from "@beastx-ctl/ui";
import { Link } from "@tanstack/react-router";
import type { KubaiIconComponent } from "kubai-icons-react";
import MonitorIcon from "kubai-icons-react/icons/monitor";
import MouseIcon from "kubai-icons-react/icons/mouse";
import PaletteIcon from "kubai-icons-react/icons/palette";
import TargetIcon from "kubai-icons-react/icons/target";
import type { ReactNode } from "react";

import { t } from "../copy/t";
import {
  grounds,
  palettes,
  setGround,
  setPalette,
  useTheme,
} from "../theme/store";

const NavItem = ({
  to,
  icon,
  label,
}: {
  to: "/mouse" | "/dpi" | "/display";
  icon: KubaiIconComponent;
  label: string;
}) => (
  <Link
    to={to}
    data-kubai-trigger
    className={`rounded-container text-muted-foreground hover:text-foreground data-[status=active]:bg-selected data-[status=active]:text-foreground relative flex h-(--size-control) items-center gap-2.5 px-3 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1 ${focusRing}`}
  >
    <Icon glyph={icon} animate />
    {label}
  </Link>
);

const ThemeMenu = () => {
  const { palette, ground } = useTheme();

  return (
    <RadioMenu
      label={t("nav.theme")}
      icon={PaletteIcon}
      groups={[
        {
          label: t("theme.palette"),
          onValueChange: (value) => {
            const hit = palettes.find((p) => p === value);

            if (hit) {
              setPalette(hit);
            }
          },
          options: palettes.map((p) => ({
            label: t(`theme.palette.${p}`),
            value: p,
          })),
          value: palette,
        },
        {
          label: t("theme.ground"),
          onValueChange: (value) => {
            const hit = grounds.find((g) => g === value);

            if (hit) {
              setGround(hit);
            }
          },
          options: grounds.map((g) => ({
            label: t(`theme.ground.${g}`),
            value: g,
          })),
          value: ground,
        },
      ]}
    />
  );
};

export const Shell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-dvh lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 pt-3 lg:sticky lg:top-0 lg:h-dvh lg:w-56 lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-0 lg:px-5 lg:pt-11 lg:pb-6">
      <Link
        to="/"
        className={`rounded-container text-foreground flex h-(--size-control) items-center px-3 font-semibold lg:mb-7 ${focusRing}`}
      >
        {t("app.name")}
      </Link>
      <nav className="flex items-center gap-1 lg:flex-1 lg:flex-col lg:items-stretch">
        <NavItem to="/mouse" icon={MouseIcon} label={t("nav.mouse")} />
        <NavItem to="/dpi" icon={TargetIcon} label={t("nav.dpi")} />
        <NavItem to="/display" icon={MonitorIcon} label={t("nav.display")} />
        <div className="lg:mt-auto">
          <ThemeMenu />
        </div>
      </nav>
    </header>
    {children}
  </div>
);
