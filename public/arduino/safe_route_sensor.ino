// SAFE Route 센서 송신 (Arduino Uno)
#include <OneWire.h>
#include <DallasTemperature.h>

const int PIN_TEMP  = 2;    // DS18B20 DATA
const int PIN_SOUND = A0;   // 소리 센서 AO
const int NOISE_MAX = 300;  // 이 진폭을 소음 100%로 봄 (센서에 맞게 조정)

OneWire oneWire(PIN_TEMP);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(9600);
  sensors.begin();
}

void loop() {
  // 0.2초 동안 소리 파형의 최대-최소 차이(진폭)를 잰다
  unsigned long t0 = millis();
  int lo = 1023, hi = 0;
  while (millis() - t0 < 200) {
    int v = analogRead(PIN_SOUND);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  int noise = constrain(map(hi - lo, 0, NOISE_MAX, 0, 100), 0, 100);

  sensors.requestTemperatures();
  float tempC = sensors.getTempCByIndex(0);

  Serial.print("T:");
  Serial.print(tempC, 1);
  Serial.print(",N:");
  Serial.println(noise);
  delay(300);
}
