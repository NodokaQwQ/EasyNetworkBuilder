import type { SvgIconComponent } from "@mui/icons-material";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { createElement, type SVGProps } from "react";
import { materialSymbol, type MaterialSymbolComponent } from "@/theme/MaterialSymbol";

const AccountBalanceWalletOutlined = materialSymbol("AccountBalanceWallet");
const AccountCircleOutlined = materialSymbol("AccountCircle");
const AlternateEmailOutlined = materialSymbol("AlternateEmail");
const AltRouteOutlined = materialSymbol("AltRoute");
const ArrowCircleRightOutlined = materialSymbol("ArrowCircleRight");
const BarChartOutlined = materialSymbol("BarChart");
const CallSplitOutlined = materialSymbol("CallSplit");
const ChatOutlined = materialSymbol("Chat");
const CodeOutlined = materialSymbol("Code");
const DashboardOutlined = materialSymbol("Dashboard");
const DescriptionOutlined = materialSymbol("Description");
const DnsOutlined = materialSymbol("Dns");
const GppGoodOutlined = materialSymbol("GppGood");
const GroupOutlined = materialSymbol("Group");
const HomeOutlined = materialSymbol("Home");
const HubOutlined = materialSymbol("Hub");
const LocalFireDepartmentOutlined = materialSymbol("LocalFireDepartment");
const MenuBookOutlined = materialSymbol("MenuBook");
const MoreHoriz = materialSymbol("MoreHoriz");
const NotificationsActiveOutlined = materialSymbol("NotificationsActive");
const NotificationsOutlined = materialSymbol("Notifications");
const PaletteOutlined = materialSymbol("Palette");
const PowerOffOutlined = materialSymbol("PowerOff");
const PublicOutlined = materialSymbol("Public");
const SettingsOutlined = materialSymbol("Settings");
const ShowChartOutlined = materialSymbol("ShowChart");
const SpeedOutlined = materialSymbol("Speed");
const StorageOutlined = materialSymbol("Storage");
const SendOutlined = materialSymbol("Send");
const ScheduleOutlined = materialSymbol("Schedule");
const StorefrontOutlined = materialSymbol("Storefront");
const TerminalOutlined = materialSymbol("Terminal");
const TrendingUpOutlined = materialSymbol("TrendingUp");
const WifiOffOutlined = materialSymbol("WifiOff");

export type AdminIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  /** Material Symbols FILL 1 for selected states; ignored by icons without a fill variant. */
  filled?: boolean;
};

export function wrapMuiIcon(Icon: SvgIconComponent | MaterialSymbolComponent) {
  function WrappedIcon({ size, color, filled, ...props }: AdminIconProps) {
    const fontSize = size == null || size === "" ? 18 : Number(size) || 18;
    return createElement(Icon as SvgIconComponent, {
      ...props,
      ...(filled ? { filled } : {}),
      sx: {
        fontSize,
        width: "1em",
        height: "1em",
        color: color || "inherit",
        display: "block",
        flexShrink: 0,
      },
    } as SvgIconProps);
  }
  WrappedIcon.displayName = Icon.name || "MuiIcon";
  return WrappedIcon;
}

export const iconMap: Record<string, ReturnType<typeof wrapMuiIcon>> = {
  Server: wrapMuiIcon(DnsOutlined),
  Bolt: wrapMuiIcon(SettingsOutlined),
  Home: wrapMuiIcon(HomeOutlined),
  BarChart2: wrapMuiIcon(BarChartOutlined),
  CircleArrowRight: wrapMuiIcon(ArrowCircleRightOutlined),
  MessageCircleMore: wrapMuiIcon(ChatOutlined),
  Ellipsis: wrapMuiIcon(MoreHoriz),
  Bell: wrapMuiIcon(NotificationsOutlined),
  BellRing: wrapMuiIcon(NotificationsActiveOutlined),
  Unplug: wrapMuiIcon(PowerOffOutlined),
  TrendingUp: wrapMuiIcon(TrendingUpOutlined),
  Users: wrapMuiIcon(GroupOutlined),
  UserCircle: wrapMuiIcon(AccountCircleOutlined),
  FileText: wrapMuiIcon(DescriptionOutlined),
  AtSign: wrapMuiIcon(AlternateEmailOutlined),
  Book: wrapMuiIcon(MenuBookOutlined),
  Activity: wrapMuiIcon(ShowChartOutlined),
  Palette: wrapMuiIcon(PaletteOutlined),
  Code: wrapMuiIcon(CodeOutlined),
  Globe: wrapMuiIcon(PublicOutlined),
  Terminal: wrapMuiIcon(TerminalOutlined),
  Hub: wrapMuiIcon(HubOutlined),
  Database: wrapMuiIcon(StorageOutlined),
  Schedule: wrapMuiIcon(ScheduleOutlined),
  WifiOff: wrapMuiIcon(WifiOffOutlined),
  Gauge: wrapMuiIcon(SpeedOutlined),
  Store: wrapMuiIcon(StorefrontOutlined),
  Route: wrapMuiIcon(AltRouteOutlined),
  CallSplit: wrapMuiIcon(CallSplitOutlined),
  LayoutDashboard: wrapMuiIcon(DashboardOutlined),
  Payments: wrapMuiIcon(AccountBalanceWalletOutlined),
  Send: wrapMuiIcon(SendOutlined),
  Shield: wrapMuiIcon(GppGoodOutlined),
  Firewall: wrapMuiIcon(LocalFireDepartmentOutlined),
};
