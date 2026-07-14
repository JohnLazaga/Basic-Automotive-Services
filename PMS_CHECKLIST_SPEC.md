# BASIC Multipoint Inspection Checklist — digital spec

Source: `Basic Auto Check List FA Seps.pdf` (2 pages, scanned). Renders saved as
`pms-checklist-page1.png` / `-page2.png` in the janice-cloud/reference folder.

This is the template the PMS tablet-checklist feature encodes. It drives the kiosk
form, the printable PDF, and the customer-portal view.

## Input types used across the form
- **rating** — 3-state indicator: `ok` (green) = Checked and OK · `attention` (yellow) =
  Requires future attention · `replace` (red) = Need attention / replacement. Optional note.
- **lr** — a rating for **Left** and **Right** separately, plus an **N/A** checkbox.
- **check** — a checkbox (done/OK) plus an optional note line.
- **measure** — a numeric value with a unit (PSI, mm, V, CCA, %).
- **text** — free-text lines.

## Header (page 1)
Customer & Vehicle: Date, Time in, Customer name, Address, Contact #, Year/Make/Model,
Mileage, Plate no, Chassis no, ETD. (Most auto-fill from the Job Order.)
- Vehicle condition **diagram** (top-view car) for marking damage.
- Service Information: "Services to be performed" (lines) + authorization paragraph + **Client signature**.
- Customer concerns (lines).

## PAGE 1

### EXTERIOR — check + note
Park light, Low beam, High beam, Fog lights, Signal lights, Wiper FR, Wiper RR,
Wiper washer, Brake lights, Third brake, Signal lights RR, Door handle, Door locks,
Fender lights, Side mirrors, Signal lights (R), Windows, Reverse light, Rear park light, Plate light

### TIRES
Per position **FR / FL / RR / RL / SPARE**:
- Before/After pressure — measure PSI (before) + PSI (after)
- Tire depth — rating
- Tire pattern / damage — rating + note
Plus: Tires rotated (check), Balanced (check), free notes.

### INTERIOR — check + note
Horn, Gauge, Seats, Seat belts, Shift knob, Matting, Windows, AC control, Radio system,
Wiper controls, Map/dome light, Hood release, Trunk release

### BRAKES
Per position **FR / FL / RR / RL**:
- Brake pads / shoe — rating + note
- Rotor disc / brake drum — rating + note
- Brake caliper / wheel cylinder — rating + note
- Brake hose — rating + note
Plus: Brakes cleaned (check), Parking brake adjusted (check), Brake fluid condition (rating).

### TEST DRIVE NOTES / FAULT CODES — text

## PAGE 2

### ENGINE BAY
- **Lubricant and fluids** — rating + note: Engine oil, Coolant, Brake fluid, Clutch fluid,
  PS fluid, Trans fluid, Diff oil, Washer fluid
- **Battery** — measure: Battery voltage (V), Stock battery CCA, Actual battery CCA,
  Charging voltage (V), Battery health (%)
- **Filters** — check + note: Air filter, Fuel filter, Cabin filter
- **Cooling system** — check + note: Radiator cap, Radiator hoses, Bypass hoses, Reservoir, Clutch fan/motor
- **Ignition system** — check + note: Ignition coil, Spark plugs, Distributor, S. plug cable
- **Engine / transmission mount** — check + note: Engine mount, Trans mount, Torque mount
- **Accessories** — check + note: Alternator, Water pump, Power steering pump, Vacuum pump,
  Aircon compressor; plus Main belt (rating), Auxiliary belts (rating)
- **Oil or fluid leaks** — check + note: Valve cover gasket, Intake hose, Turbo hose, Intercooler,
  Spool valve, Oil pan gasket, Axle oil seals, Camshaft oil seal, Frt crank seal, RR crank seal,
  Trans oil seal, Diff oil seal

### DRIVETRAIN — check + note
Clutch pedal, Shifter linkage/cable, Inner CV joint front, Inner CV joint rear,
Outer CV joint front, Outer CV joint rear, CV boots & straps, Clutch master, Clutch slave,
Wheel bearing RR, Wheel bearing RL, Wheel bearing FR, Wheel bearing FL, Cross joint,
Differential, Center bearing

### STEERING & SUSPENSION
- **Stabilizer** — lr (L/R + N/A): Stabilizer link front, Stabilizer link rear,
  Stabilizer bar bushing front, Stabilizer bar bushing rear
- **Lower arm front** — lr: Lower arm big bushing, Lower arm small bushing, Lower arm ball joint, Caster bar bushing
- **Upper arm front** — lr: Big bushing, Small bushing, Ball joint  *(doc prints these as "Lower arm …" under the Upper Arm heading)*
- **Shock absorber front** — lr: Shock piston, Shock boots, Shock mounting, Shock bushing
- **Shock absorber rear** — lr: Shock piston, Shock boots, Shock mounting, Shock bushing
- **Single items** — check + note: Rear suspension bushings, Torsion bar front, Torsion beam,
  Trailing arms, Panhard rod, Leaf springs, Leaf spring bushings, Coil springs, Coil spring pads,
  Lateral links, Rear ball joints
- **Steering** — lr: Outer tie rod, Inner tie rod / rack end, Steering boots
- **Steering single** — check + note: Steering rack assembly, Steering gear box, Center link,
  Idler arm, Center post, Pitman arm, Power steering hoses

### NOTES — text
Footer: Mechanic, Service Adviser (kiosk: picked from staff dropdown on submit).
