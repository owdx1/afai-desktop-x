import { Globe } from "lucide-react";
import i18n from "../lib/i18n";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "../components/ui/select";

export const LanguageSelector = () => (
  <div className="flex items-center gap-2 z-50">
    <Globe size={16} />
    <Select
      onValueChange={(value) => i18n.changeLanguage(value)}
      defaultValue={i18n.language}
    >
      <SelectTrigger className="w-[120px]">
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="es">Español</SelectItem>
        <SelectItem value="ja">日本語</SelectItem>
        <SelectItem value="tr">Türkçe</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
