import type { SafeModeAction } from "../../preload/types"
import type { Component } from "solid-js"
import { executeSafeModeAction } from "../safe-mode-logic"

interface SafeModeCardProps {
  title: string
  description: string
  action: SafeModeAction
}

export const SafeModeCard: Component<SafeModeCardProps> = (props) => {
  const handleClick = () => {
    executeSafeModeAction(props.action)
  }

  return (
    <button
      class="flex flex-col items-start gap-2 rounded-lg border border-surface-weak bg-surface-base p-4 text-left hover:bg-surface-weak transition-colors cursor-pointer w-full"
      onClick={handleClick}
      aria-label={props.title}
    >
      <span class="text-14-semibold text-text-strong">{props.title}</span>
      <span class="text-12-regular text-text-weak">{props.description}</span>
    </button>
  )
}
