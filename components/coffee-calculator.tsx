"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const QUICK_PRESETS = [
  { label: "Single Cup", value: 250 },
  { label: "Two Cups", value: 500 },
  { label: "Full Pot", value: 750 },
];

const RATIO_PRESETS = [15, 16, 17, 18].map(value => ({
  label: `1:${value}`,
  value,
}));

type PresetButtonProps<T> = {
  presets: Array<{ label: string; value: T }>;
  currentValue: T;
  onSelect: (value: T) => void;
  size?: "sm" | "lg";
};

const PresetButtons = <T,>({ presets, currentValue, onSelect, size = "sm" }: PresetButtonProps<T>) => (
  <div className="flex gap-2">
    {presets.map(preset => (
      <Button
        key={preset.label}
        variant={currentValue === preset.value ? "default" : "outline"}
        size={size}
        className="flex-1 w-full"
        onClick={() => onSelect(preset.value)}>
        {preset.label}
      </Button>
    ))}
  </div>
);

export function CoffeeCalculatorComponent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [waterVolume, setWaterVolume] = useState("250");
  const [ratio, setRatio] = useState(16);

  const coffeeGrounds = useMemo(() => {
    const waterValue = parseFloat(waterVolume) || 0;
    return Math.round((waterValue / ratio) * 10) / 10;
  }, [waterVolume, ratio]);

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.focus();
    const length = waterVolume.length;
    inputRef.current.setSelectionRange(length, length);
  }, []);

  const handleWaterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only numbers and empty string
    const value = e.target.value.replace(/[^0-9]/g, "");
    setWaterVolume(value);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900 p-0 sm:p-4">
      <Card className="w-full h-screen sm:h-auto sm:max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Coffee-to-Water Ratio Calculator</CardTitle>
          <CardDescription>Calculate the perfect coffee-to-water ratio for your brew.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-y-2 justify-between items-center">
                <Label htmlFor="water-volume" className="mr-4">
                  Water (ml)
                </Label>
                <PresetButtons
                  presets={QUICK_PRESETS}
                  currentValue={parseFloat(waterVolume)}
                  onSelect={value => setWaterVolume(value.toString())}
                />
              </div>
              <Input
                ref={inputRef}
                id="water-volume"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={waterVolume}
                onChange={handleWaterChange}
              />
            </div>

            <div>
              <Label>Coffee-to-Water Ratio</Label>
              <div className="mt-2">
                <PresetButtons presets={RATIO_PRESETS} currentValue={ratio} onSelect={setRatio} size="lg" />
              </div>
            </div>

            <div>
              <Label>Coffee Grounds Needed</Label>
              <p className="text-2xl font-bold">{coffeeGrounds} grams</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
