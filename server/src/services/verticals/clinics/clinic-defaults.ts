// ---------------------------------------------------------------------------
// Default clinic specialties, ICD-10 codes, lab tests and consultation fees
// ---------------------------------------------------------------------------
//
// Prices are stored as integer "fils" (1 KWD = 1000 fils). This matches the
// 3-decimal precision used in Kuwait for currency, while still using
// `amountCents` semantics for storage compatibility.

export interface DefaultSpecialty {
  name: string;
  nameAr: string;
  /** Standard consultation fee in fils (1 KWD = 1000 fils). */
  consultationFeeCents: number;
}

export const DEFAULT_SPECIALTIES: DefaultSpecialty[] = [
  { name: "General Medicine", nameAr: "طب عام", consultationFeeCents: 15000 },
  { name: "Pediatrics", nameAr: "طب الأطفال", consultationFeeCents: 20000 },
  { name: "Dermatology", nameAr: "جلدية", consultationFeeCents: 25000 },
  { name: "Cardiology", nameAr: "قلب", consultationFeeCents: 30000 },
  { name: "Orthopedics", nameAr: "عظام", consultationFeeCents: 25000 },
  { name: "Dentistry", nameAr: "طب الأسنان", consultationFeeCents: 20000 },
];

export interface DefaultIcd10Code {
  code: string;
  description: string;
}

// Commonly seen primary-care / clinic diagnoses (~50 entries).
export const DEFAULT_ICD10_CODES: DefaultIcd10Code[] = [
  { code: "J06.9", description: "Acute upper respiratory infection, unspecified" },
  { code: "J00", description: "Acute nasopharyngitis (common cold)" },
  { code: "J02.9", description: "Acute pharyngitis, unspecified" },
  { code: "J03.9", description: "Acute tonsillitis, unspecified" },
  { code: "J20.9", description: "Acute bronchitis, unspecified" },
  { code: "J45.909", description: "Asthma, unspecified, uncomplicated" },
  { code: "J30.9", description: "Allergic rhinitis, unspecified" },
  { code: "K59.0", description: "Constipation, unspecified" },
  { code: "K21.9", description: "Gastro-esophageal reflux disease without esophagitis" },
  { code: "K29.70", description: "Gastritis, unspecified, without bleeding" },
  { code: "K52.9", description: "Noninfective gastroenteritis and colitis, unspecified" },
  { code: "A09", description: "Infectious gastroenteritis and colitis, unspecified" },
  { code: "R10.9", description: "Unspecified abdominal pain" },
  { code: "R11.2", description: "Nausea with vomiting, unspecified" },
  { code: "R51", description: "Headache" },
  { code: "G43.909", description: "Migraine, unspecified, not intractable, without status migrainosus" },
  { code: "R50.9", description: "Fever, unspecified" },
  { code: "R05", description: "Cough" },
  { code: "R07.9", description: "Chest pain, unspecified" },
  { code: "R42", description: "Dizziness and giddiness" },
  { code: "R53.83", description: "Other fatigue" },
  { code: "I10", description: "Essential (primary) hypertension" },
  { code: "E11.9", description: "Type 2 diabetes mellitus without complications" },
  { code: "E78.5", description: "Hyperlipidemia, unspecified" },
  { code: "E66.9", description: "Obesity, unspecified" },
  { code: "E03.9", description: "Hypothyroidism, unspecified" },
  { code: "E55.9", description: "Vitamin D deficiency, unspecified" },
  { code: "D50.9", description: "Iron deficiency anemia, unspecified" },
  { code: "M54.5", description: "Low back pain" },
  { code: "M54.2", description: "Cervicalgia (neck pain)" },
  { code: "M25.50", description: "Pain in unspecified joint" },
  { code: "M79.1", description: "Myalgia" },
  { code: "M62.838", description: "Other muscle spasm" },
  { code: "L20.9", description: "Atopic dermatitis, unspecified" },
  { code: "L23.9", description: "Allergic contact dermatitis, unspecified cause" },
  { code: "L70.0", description: "Acne vulgaris" },
  { code: "L50.9", description: "Urticaria, unspecified" },
  { code: "B35.3", description: "Tinea pedis (athlete's foot)" },
  { code: "H10.9", description: "Unspecified conjunctivitis" },
  { code: "H66.90", description: "Otitis media, unspecified, unspecified ear" },
  { code: "H81.10", description: "Benign paroxysmal vertigo, unspecified ear" },
  { code: "N39.0", description: "Urinary tract infection, site not specified" },
  { code: "N30.00", description: "Acute cystitis without hematuria" },
  { code: "F41.9", description: "Anxiety disorder, unspecified" },
  { code: "F32.9", description: "Major depressive disorder, single episode, unspecified" },
  { code: "F51.01", description: "Primary insomnia" },
  { code: "Z00.00", description: "Encounter for general adult medical examination" },
  { code: "Z23", description: "Encounter for immunization" },
  { code: "Z71.3", description: "Dietary counseling and surveillance" },
  { code: "Z01.89", description: "Encounter for other specified special examinations" },
];

export interface DefaultLabTest {
  testCode: string;
  testName: string;
  /** Price in fils (1 KWD = 1000 fils). */
  priceCents: number;
}

export const DEFAULT_LAB_TESTS: DefaultLabTest[] = [
  { testCode: "CBC", testName: "Complete Blood Count", priceCents: 4000 },
  { testCode: "CMP", testName: "Comprehensive Metabolic Panel", priceCents: 6000 },
  { testCode: "LIPID", testName: "Lipid Panel", priceCents: 5000 },
  { testCode: "HBA1C", testName: "Hemoglobin A1c", priceCents: 4500 },
  { testCode: "TSH", testName: "Thyroid Stimulating Hormone", priceCents: 5000 },
  { testCode: "VITD", testName: "Vitamin D, 25-Hydroxy", priceCents: 7000 },
  { testCode: "UA", testName: "Urinalysis", priceCents: 3000 },
  { testCode: "FBS", testName: "Fasting Blood Sugar", priceCents: 2000 },
  { testCode: "LFT", testName: "Liver Function Tests", priceCents: 5500 },
  { testCode: "KFT", testName: "Kidney Function Tests", priceCents: 5500 },
];

// A small autocomplete drug list (used by the prescription builder UI).
export const DEFAULT_DRUG_LIST: string[] = [
  "Paracetamol",
  "Ibuprofen",
  "Amoxicillin",
  "Azithromycin",
  "Ciprofloxacin",
  "Metformin",
  "Atorvastatin",
  "Lisinopril",
  "Amlodipine",
  "Losartan",
  "Omeprazole",
  "Pantoprazole",
  "Ranitidine",
  "Cetirizine",
  "Loratadine",
  "Salbutamol",
  "Prednisolone",
  "Levothyroxine",
  "Vitamin D3",
  "Iron + Folic Acid",
];

export interface DefaultDoctor {
  name: string;
  nameAr: string;
  specialty: string;
  licenseNumber: string;
  consultationFeeCents: number;
}

export const DEFAULT_DOCTORS: DefaultDoctor[] = [
  {
    name: "Dr. Ahmed Al-Sabah",
    nameAr: "د. أحمد الصباح",
    specialty: "General Medicine",
    licenseNumber: "KW-MOH-1001",
    consultationFeeCents: 15000,
  },
  {
    name: "Dr. Fatima Al-Rashid",
    nameAr: "د. فاطمة الراشد",
    specialty: "Pediatrics",
    licenseNumber: "KW-MOH-1002",
    consultationFeeCents: 20000,
  },
];
