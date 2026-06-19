import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  getNotificationSoundSettings,
  setNotificationSoundSettings,
  primeNotificationAudioFromUserGesture,
  playMessageNotificationSound,
  playSessionReminderSound,
  playEmergencyAlertSound,
  type MessageVariant,
  subscribeNotificationSoundSettings,
} from "@/lib/sounds/notificationSoundManager";

export function NotificationSoundSettingsPanel() {
  const [s, setS] = useState(getNotificationSoundSettings);

  useEffect(() => {
    const unsubscribe = subscribeNotificationSoundSettings(() => setS(getNotificationSoundSettings()));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const volumePct = Math.round(s.masterVolume * 100);

  return (
    <div className="space-y-4 py-1 w-[min(100vw-2rem,18rem)]">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound-mute" className="text-sm font-medium">
            Mute all sounds
          </Label>
          <Switch
            id="sound-mute"
            checked={s.masterMuted}
            onCheckedChange={(v) => setNotificationSoundSettings({ masterMuted: Boolean(v) })}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Volume</span>
            <span className="tabular-nums">{volumePct}%</span>
          </div>
          <Slider
            disabled={s.masterMuted}
            value={[volumePct]}
            min={5}
            max={100}
            step={1}
            onValueChange={([v]) => setNotificationSoundSettings({ masterVolume: (v ?? 85) / 100 })}
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound-msg" className="text-sm">
            Chat messages
          </Label>
          <Switch
            id="sound-msg"
            checked={s.messageEnabled}
            disabled={s.masterMuted}
            onCheckedChange={(v) => setNotificationSoundSettings({ messageEnabled: Boolean(v) })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound-ring" className="text-sm">
            Call ringtones
          </Label>
          <Switch
            id="sound-ring"
            checked={s.callRingtoneEnabled}
            disabled={s.masterMuted}
            onCheckedChange={(v) => setNotificationSoundSettings({ callRingtoneEnabled: Boolean(v) })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound-rem" className="text-sm">
            Session reminders
          </Label>
          <Switch
            id="sound-rem"
            checked={s.reminderEnabled}
            disabled={s.masterMuted}
            onCheckedChange={(v) => setNotificationSoundSettings({ reminderEnabled: Boolean(v) })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound-em" className="text-sm">
            Emergency / crisis alerts
          </Label>
          <Switch
            id="sound-em"
            checked={s.emergencyEnabled}
            disabled={s.masterMuted}
            onCheckedChange={(v) => setNotificationSoundSettings({ emergencyEnabled: Boolean(v) })}
          />
        </div>
      </div>

      <div className="space-y-2 border-t border-border/60 pt-3">
        <Label className="text-sm">Message tone</Label>
        <div className="flex gap-2">
          {(
            [
              { id: "standard" as const, label: "Standard" },
              { id: "soft" as const, label: "Soft" },
            ] satisfies { id: MessageVariant; label: string }[]
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={s.messageVariant === opt.id ? "secondary" : "outline"}
              className="flex-1 text-xs"
              disabled={s.masterMuted}
              onClick={() => setNotificationSoundSettings({ messageVariant: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => {
            primeNotificationAudioFromUserGesture();
            playMessageNotificationSound({ batchKey: `test-${Date.now()}` });
          }}
        >
          Test message
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => {
            primeNotificationAudioFromUserGesture();
            playSessionReminderSound();
          }}
        >
          Test reminder
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => {
            primeNotificationAudioFromUserGesture();
            playEmergencyAlertSound();
          }}
        >
          Test emergency
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Short sounds use soft synthesized tones (similar polish to WhatsApp / Discord). Call ringtones fade in
        and out. Message and reminder volume dips slightly when this tab is in the background. Some mobile
        browsers need a tap before audio can play.
      </p>
    </div>
  );
}
