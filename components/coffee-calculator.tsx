"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CoffeeCalculatorComponent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [waterVolume, setWaterVolume] = useState(250);
  const [ratio, setRatio] = useState(16);
  const [coffeeGrounds, setCoffeeGrounds] = useState(0);

  const calculateCoffee = useCallback(() => {
    const grounds = waterVolume / ratio;
    setCoffeeGrounds(Math.round(grounds * 10) / 10);
  }, [waterVolume, ratio]);

  useEffect(() => {
    calculateCoffee();
  }, [calculateCoffee]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleWaterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setWaterVolume(value);
    }
  };

  const quickPresets = [
    { label: "Single Cup", value: 250 },
    { label: "Two Cups", value: 500 },
    { label: "Full Pot", value: 1000 },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Coffee-to-Water Ratio Calculator</CardTitle>
          <CardDescription>Calculate the perfect coffee-to-water ratio for your brew.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-y-2 justify-between items-center">
                <Label htmlFor="water-volume" className="mr-4">
                  Water Volume (ml)
                </Label>
                <div className="flex flex-wrap gap-2">
                  {quickPresets.map(preset => (
                    <Button
                      key={preset.label}
                      variant={waterVolume === preset.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setWaterVolume(preset.value)}>
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Input ref={inputRef} id="water-volume" type="number" value={waterVolume} onChange={handleWaterChange} min={0} step={10} />
            </div>

            <div>
              <Label>Coffee-to-Water Ratio</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {[15, 16, 17, 18].map(preset => (
                  <Button
                    key={preset}
                    variant={ratio === preset ? "default" : "outline"}
                    size="lg"
                    className="flex-1"
                    onClick={() => setRatio(preset)}>
                    1:{preset}
                  </Button>
                ))}
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
