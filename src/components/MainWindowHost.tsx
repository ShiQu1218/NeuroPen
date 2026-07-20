import { useMainWindowController } from "../hooks/useMainWindowController";
import { useTrayLlmMenu } from "../hooks/useTrayLlmMenu";

export default function MainWindowHost() {
  useMainWindowController();
  useTrayLlmMenu();
  return null;
}
