import {
  Activity,
  Coffee,
  Keyboard,
  LampDesk,
  Package,
  Sparkles,
} from "lucide-react";

export function getIcon(productId: string) {
    switch(productId) {
        case "3c-accessories":
            return Keyboard;
        case "home-living":
            return LampDesk;
        case "beauty":
            return Sparkles;
        case "sports-outdoor":
            return Activity;
        case "food-drink":
            return Coffee;
        default:
            return Package;
    }
}
