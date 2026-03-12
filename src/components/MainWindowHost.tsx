import { useMainWindowController } from "../hooks/useMainWindowController";

export default function MainWindowHost() {
  useMainWindowController();
  return null;
}
