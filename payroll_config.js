// ============================================
// Payroll Configuration
// Edit these values to keep the payroll report accurate.
// All values are "current snapshot" only in Phase 1 — past months
// will be recalculated using these numbers, not historical ones.
// ============================================

const PAYROLL_RATE = 0.001; // RM per (seedling × successful watering session)

const AREA_OPERATORS = {
    BNN: 'Hasannudin',
    UNN1: 'Salim',
    UNN2: 'Lalu Fahri'
};

// Seedling count per plot. Update whenever planting changes.
// Plots set to 0 will contribute nothing to the total — fill these in.
const PLOT_SEEDLINGS = {
    // BNN area
    'B1': 0, 'B2': 0, 'B3': 0, 'B4': 0, 'B5': 0, 'B6': 0, 'B7': 0,
    'B8': 0, 'B9': 0, 'B10': 0, 'B11': 0, 'B12': 0, 'B13': 0, 'B14': 0,
    // UNN1 area
    'U1': 0, 'U2': 0, 'U3': 0, 'U4': 0, 'U5': 0, 'U6': 0, 'U7': 0,
    'U8': 0, 'U9': 0, 'U10': 0, 'U11': 0, 'U12': 0, 'U13': 0, 'U14': 0,
    'U15': 0, 'U16': 0, 'U17': 0, 'U18': 0,
    // UNN2 area
    'N1': 0, 'N2': 0, 'N3': 0, 'N4': 0, 'N5': 0, 'N6': 0, 'N7': 0,
    'N8': 0, 'N9': 0, 'N10': 0, 'N11': 0, 'N12': 0, 'N13': 0, 'N14': 0,
    'N15': 0, 'N16': 0, 'N17': 0, 'N18': 0, 'N19': 0, 'N20': 0
};

const COMPANY_NAME = 'MEGA JUTAMAS SDN BHD (Ulu & Batu Niah Nursery)';
const EQUIPMENT = 'Water Pump';
const PAYROLL_LOCATION = 'UNN1, UNN2, BNN';
