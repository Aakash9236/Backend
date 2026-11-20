import {
  DefaultWorkerKycPolicyProvider,
  WorkerKycValidationService,
  WorkerKycRule,
  WorkerDocumentRecord,
  WorkerSkillRecord,
  IWorkerKycPolicyProvider,
} from '../src/modules/workers/services/worker-kyc.service';
import { WorkerProfileRepository } from '../src/modules/workers/repositories/worker-profile.repository';
import { WorkerDocumentRepository } from '../src/modules/workers/repositories/worker-document.repository';
import { WorkerSkillRepository } from '../src/modules/workers/repositories/worker-skill.repository';
import { prisma } from '../src/config/db.config';

describe('Phase 6E Batch 2: Worker KYC Policy & Validation Service', () => {
  let policyProvider: DefaultWorkerKycPolicyProvider;
  let validationService: WorkerKycValidationService;

  beforeEach(() => {
    policyProvider = new DefaultWorkerKycPolicyProvider();
    validationService = new WorkerKycValidationService(policyProvider);
  });

  // ==========================================================================
  // 1. Policy Provider & Configuration
  // ==========================================================================
  describe('1. Policy Provider & Worker Type Baselines', () => {
    it('should return baseline default rules when no worker type or category is specified', async () => {
      const rules = await policyProvider.getRulesForWorker({});
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'PROFILE_PHOTO'])
      );
      expect(rules?.minExperienceYears).toBe(0);
    });

    it('should configure HELPER baseline with identity proof and profile photo', async () => {
      const rules = await policyProvider.getRulesForWorker({ workerType: 'HELPER' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'PROFILE_PHOTO'])
      );
      expect(rules?.minExperienceYears).toBe(0);
      expect(rules?.requiresPoliceVerification).toBeFalsy();
    });

    it('should configure TECHNICIAN baseline requiring skill certificate and police verification with min 1 yr exp', async () => {
      const rules = await policyProvider.getRulesForWorker({ workerType: 'TECHNICIAN' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining([
          'IDENTITY_PROOF',
          'PROFILE_PHOTO',
          'SKILL_CERTIFICATE',
          'POLICE_VERIFICATION',
        ])
      );
      expect(rules?.minExperienceYears).toBe(1);
      expect(rules?.requiresSkillCertificate).toBe(true);
      expect(rules?.requiresPoliceVerification).toBe(true);
    });

    it('should configure SPECIALIST baseline requiring medical fitness, police verification, skill certificate and min 3 yrs exp', async () => {
      const rules = await policyProvider.getRulesForWorker({ workerType: 'SPECIALIST' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining([
          'IDENTITY_PROOF',
          'PROFILE_PHOTO',
          'SKILL_CERTIFICATE',
          'POLICE_VERIFICATION',
          'MEDICAL_FITNESS',
        ])
      );
      expect(rules?.minExperienceYears).toBe(3);
      expect(rules?.requiresMedicalFitness).toBe(true);
    });

    it('should support composite rules (Worker Type + Service Category)', async () => {
      policyProvider.setCompositeRule('TECHNICIAN:ELECTRICAL', {
        requiredDocumentTypes: [
          'IDENTITY_PROOF',
          'PROFILE_PHOTO',
          'SKILL_CERTIFICATE',
          'POLICE_VERIFICATION',
          'ELECTRICAL_WORKMAN_PERMIT',
        ],
        requiredVerifiedSkillCategories: ['ELECTRICAL'],
        minExperienceYears: 2,
        requiresSkillCertificate: true,
        legalApplicabilityNotes: 'Mandatory state electrical workman licence',
      });

      const elecRule = await policyProvider.getRulesForWorker({
        workerType: 'TECHNICIAN',
        serviceCategoryCode: 'ELECTRICAL',
      });

      expect(elecRule?.requiredDocumentTypes).toContain('ELECTRICAL_WORKMAN_PERMIT');
      expect(elecRule?.requiredVerifiedSkillCategories).toContain('ELECTRICAL');
      expect(elecRule?.minExperienceYears).toBe(2);
    });

    it('should merge multiple matching rules applying most restrictive mandatory requirements', async () => {
      // 1. WorkerType rule gives min 1 yr and POLICE_VERIFICATION
      // 2. Add ServiceCategory rule requiring 4 yrs and HAZMAT_CLEARANCE
      policyProvider.setServiceCategoryRule('HIGH_VOLTAGE', {
        requiredDocumentTypes: ['HAZMAT_CLEARANCE'],
        minExperienceYears: 4,
        legalApplicabilityNotes: 'High voltage handling protocols',
      });

      const merged = await policyProvider.getRulesForWorker({
        workerType: 'TECHNICIAN',
        serviceCategoryCode: 'HIGH_VOLTAGE',
      });

      expect(merged).toBeDefined();
      // Union of required documents
      expect(merged?.requiredDocumentTypes).toContain('IDENTITY_PROOF');
      expect(merged?.requiredDocumentTypes).toContain('SKILL_CERTIFICATE');
      expect(merged?.requiredDocumentTypes).toContain('POLICE_VERIFICATION');
      expect(merged?.requiredDocumentTypes).toContain('HAZMAT_CLEARANCE');
      // Maximum experience
      expect(merged?.minExperienceYears).toBe(4);
    });
  });

  // ==========================================================================
  // 2. Fail-Closed Security Gates
  // ==========================================================================
  describe('2. Fail-Closed Security Gates', () => {
    it('should fail closed when policy provider is missing or null', async () => {
      const brokenService = new WorkerKycValidationService(null as any);
      const result = await brokenService.validateForApproval({}, [], []);

      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toMatch(/policy provider unavailable: Security gate fail-closed/i);
    });

    it('should fail closed when policy provider throws an unexpected error', async () => {
      const throwingProvider: IWorkerKycPolicyProvider = {
        getRulesForWorker: jest.fn().mockRejectedValue(new Error('Database timeout')),
      };
      const throwingService = new WorkerKycValidationService(throwingProvider);
      const result = await throwingService.validateForApproval({}, [], []);

      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toMatch(/policy retrieval failed: Security gate fail-closed/i);
    });

    it('should fail closed when policy provider returns null or invalid specification', async () => {
      const nullProvider: IWorkerKycPolicyProvider = {
        getRulesForWorker: jest.fn().mockResolvedValue(null),
      };
      const nullService = new WorkerKycValidationService(nullProvider);
      const result = await nullService.validateForApproval({}, [], []);

      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toMatch(/Invalid or missing worker KYC policy specification/i);
    });

    it('should fail closed when requiredDocumentTypes is not an array', async () => {
      const corruptProvider: IWorkerKycPolicyProvider = {
        getRulesForWorker: jest.fn().mockResolvedValue({ requiredDocumentTypes: 'not-an-array' } as any),
      };
      const corruptService = new WorkerKycValidationService(corruptProvider);
      const result = await corruptService.validateForApproval({}, [], []);

      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toMatch(/Invalid or missing worker KYC policy specification/i);
    });
  });

  // ==========================================================================
  // 3. Anti-Bypass Mandatory Document Evaluation
  // ==========================================================================
  describe('3. Anti-Bypass Mandatory Document Evaluation', () => {
    it('should fail if mandatory documents are completely missing', async () => {
      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        [],
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.missingTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'PROFILE_PHOTO'])
      );
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'Mandatory worker document missing: IDENTITY_PROOF',
          'Mandatory worker document missing: PROFILE_PHOTO',
        ])
      );
    });

    it('should recognize valid aliases for IDENTITY_PROOF (AADHAAR, PAN, VOTER_ID, PASSPORT)', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'AADHAAR',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date(),
        },
        {
          id: 2n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date(),
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        []
      );

      expect(result.missingTypes).not.toContain('IDENTITY_PROOF');
      expect(result.isValid).toBe(true);
    });

    it('should strictly evaluate ONLY the latest document (uploadedAt DESC, id DESC)', async () => {
      // Worker had a VERIFIED identity document, but uploaded a replacement that is currently PENDING
      const docs: WorkerDocumentRecord[] = [
        {
          id: 10n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 20n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'PENDING',
          uploadedAt: new Date('2026-02-01T10:00:00Z'), // newer upload
        },
        {
          id: 30n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        []
      );

      // Anti-bypass gate: must NOT fall back to older doc (id: 10n)
      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('IDENTITY_PROOF');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Mandatory document 'IDENTITY_PROOF' verification is pending (replacement under review)"),
        ])
      );
    });

    it('should fail immediately when the latest document is REJECTED', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'REJECTED',
          rejectionReason: 'Blurred text and unreadable name',
          uploadedAt: new Date('2026-02-01T10:00:00Z'),
        },
        {
          id: 3n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('IDENTITY_PROOF');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "Mandatory document 'IDENTITY_PROOF' was rejected: Blurred text and unreadable name",
        ])
      );
    });

    it('should deterministically break timestamp ties using id DESC', async () => {
      const sharedDate = new Date('2026-01-01T12:00:00Z');
      const docs: WorkerDocumentRecord[] = [
        {
          id: 100n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: sharedDate,
        },
        {
          id: 101n, // Higher ID -> newer document
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'PENDING',
          uploadedAt: sharedDate,
        },
        {
          id: 102n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: sharedDate,
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('IDENTITY_PROOF');
    });
  });

  // ==========================================================================
  // 4. Asia/Kolkata Calendar Expiry & 15-Day Warning
  // ==========================================================================
  describe('4. Asia/Kolkata Calendar Expiry & Warning', () => {
    it('should accept a document as valid throughout its expiry calendar date in IST', async () => {
      // Expiry date: 2026-06-30
      // Reference date: 2026-06-30 at 18:00:00 UTC (23:30:00 IST) -> Still valid on that calendar day
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-06-30T00:00:00Z'),
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      const refDate = new Date('2026-06-30T18:00:00Z'); // 23:30 IST on June 30
      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        refDate
      );

      expect(result.isValid).toBe(true);
      expect(result.expiredTypes).toHaveLength(0);
    });

    it('should mark a document as expired at 00:00:00 IST the next day (zero grace period)', async () => {
      // Expiry date: 2026-06-30
      // Reference date: 2026-06-30 at 18:30:01 UTC (00:00:01 IST on July 1) -> Expired
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-06-30T00:00:00Z'),
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      const refDate = new Date('2026-06-30T18:30:01Z'); // 00:00:01 IST on July 1
      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        refDate
      );

      expect(result.isValid).toBe(false);
      expect(result.expiredTypes).toContain('IDENTITY_PROOF');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Mandatory document 'IDENTITY_PROOF' expired"),
        ])
      );
    });

    it('should flag DOCUMENT_EXPIRING_SOON warning within 15 days of expiry', async () => {
      // Expiry date: 2026-07-10
      // Reference date: 2026-07-01 (9 days remaining <= 15 days)
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-07-10T00:00:00Z'),
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      const refDate = new Date('2026-07-01T00:00:00Z');
      const result = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        refDate
      );

      expect(result.isValid).toBe(true);
      expect(result.expiringSoonTypes).toContain('IDENTITY_PROOF');
      expect(result.documentWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentType: 'IDENTITY_PROOF',
            warning: 'DOCUMENT_EXPIRING_SOON',
          }),
        ])
      );
    });
  });

  // ==========================================================================
  // 5. Skill & Qualification Validation
  // ==========================================================================
  describe('5. Skill & Qualification Validation', () => {
    it('should fail when worker lacks required skill category', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO'],
        requiredVerifiedSkillCategories: ['ELECTRICAL'],
      });

      const docs: WorkerDocumentRecord[] = [
        { id: 1n, documentType: 'IDENTITY_PROOF', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 2n, documentType: 'PROFILE_PHOTO', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        [] // No skills
      );

      expect(result.isValid).toBe(false);
      expect(result.missingSkills).toContain('ELECTRICAL');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "Required skill category 'ELECTRICAL' is not added to worker profile.",
        ])
      );
    });

    it('should fail when required skill category is present but not yet VERIFIED', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO'],
        requiredVerifiedSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        { id: 1n, documentType: 'IDENTITY_PROOF', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 2n, documentType: 'PROFILE_PHOTO', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
      ];

      const skills: WorkerSkillRecord[] = [
        {
          id: 1n,
          serviceCategoryId: 55n,
          serviceCategory: { id: 55n, categoryCode: 'PLUMBING' },
          verificationStatus: 'PENDING',
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        skills
      );

      expect(result.isValid).toBe(false);
      expect(result.unverifiedSkills).toContain('PLUMBING');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "Required skill category 'PLUMBING' is not verified (status: PENDING).",
        ])
      );
    });

    it('should pass when required skill category is present and VERIFIED', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO'],
        requiredVerifiedSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        { id: 1n, documentType: 'IDENTITY_PROOF', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 2n, documentType: 'PROFILE_PHOTO', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
      ];

      const skills: WorkerSkillRecord[] = [
        {
          id: 1n,
          serviceCategoryId: 55n,
          serviceCategory: { id: 55n, categoryCode: 'PLUMBING' },
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        skills
      );

      expect(result.isValid).toBe(true);
      expect(result.missingSkills).toHaveLength(0);
      expect(result.unverifiedSkills).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 6. Experience Years Validation
  // ==========================================================================
  describe('6. Experience Years Validation', () => {
    it('should fail when worker experience is less than required by policy', async () => {
      const docs: WorkerDocumentRecord[] = [
        { id: 1n, documentType: 'IDENTITY_PROOF', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 2n, documentType: 'PROFILE_PHOTO', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 3n, documentType: 'SKILL_CERTIFICATE', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 4n, documentType: 'POLICE_VERIFICATION', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 5n, documentType: 'MEDICAL_FITNESS', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
      ];

      // SPECIALIST requires min 3 years experience
      const result = await validationService.validateForApproval(
        { workerType: 'SPECIALIST', experienceYears: 1 },
        docs,
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.experienceShortfall).toBe(2);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'Worker has 1 year(s) of experience, but minimum required is 3 year(s) (2 year(s) shortfall).',
        ])
      );
    });

    it('should pass when worker experience meets or exceeds required', async () => {
      const docs: WorkerDocumentRecord[] = [
        { id: 1n, documentType: 'IDENTITY_PROOF', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 2n, documentType: 'PROFILE_PHOTO', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 3n, documentType: 'SKILL_CERTIFICATE', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 4n, documentType: 'POLICE_VERIFICATION', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
        { id: 5n, documentType: 'MEDICAL_FITNESS', verificationStatus: 'VERIFIED', uploadedAt: new Date() },
      ];

      const result = await validationService.validateForApproval(
        { workerType: 'SPECIALIST', experienceYears: 5 },
        docs,
        []
      );

      expect(result.isValid).toBe(true);
      expect(result.experienceShortfall).toBeUndefined();
    });
  });

  // ==========================================================================
  // 7. Database Integration via validateWorkerWithRepository
  // ==========================================================================
  describe('7. Repository Integration', () => {
    it('should fail closed when worker profile does not exist in repository', async () => {
      const result = await validationService.validateWorkerWithRepository(99999999n);
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('Worker profile with ID 99999999 not found');
    });
  });
});
