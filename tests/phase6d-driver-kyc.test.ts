import {
  DefaultDriverKycPolicyProvider,
  DriverKycValidationService,
  DriverKycRule,
  DriverDocumentRecord,
  IDriverKycPolicyProvider,
} from '../src/modules/drivers/services/driver-kyc.service';
import { DriverProfileRepository } from '../src/modules/drivers/repositories/driver-profile.repository';
import { DriverDocumentRepository } from '../src/modules/drivers/repositories/driver-document.repository';
import { prisma } from '../src/config/db.config';

describe('Phase 6D Milestone 3.1: Driver KYC Policy & Validation Service', () => {
  let policyProvider: DefaultDriverKycPolicyProvider;
  let validationService: DriverKycValidationService;

  beforeEach(() => {
    policyProvider = new DefaultDriverKycPolicyProvider();
    validationService = new DriverKycValidationService(policyProvider);
  });

  // ==========================================================================
  // 1. Policy Provider Configuration & Vehicle Class Mappings
  // ==========================================================================
  describe('1. Policy Provider & Vehicle Class Mappings', () => {
    it('should return baseline default rules when no vehicle type is specified', async () => {
      const rules = await policyProvider.getRulesForDriver({});
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO'])
      );
      expect(rules?.optionalDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF'])
      );
      expect(rules?.allowedLicenceClasses).toEqual(
        expect.arrayContaining(['MCWG', 'LMV', 'TRANS'])
      );
    });

    it('should configure TWO_WHEELER with MCWG, LMV, TRANS licence classes', async () => {
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'TWO_WHEELER' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(['DRIVING_LICENCE', 'PROFILE_PHOTO']);
      expect(rules?.optionalDocumentTypes).toEqual(['IDENTITY_PROOF']);
      expect(rules?.allowedLicenceClasses).toEqual(['MCWG', 'LMV', 'TRANS']);
    });

    it('should configure THREE_WHEELER requiring IDENTITY_PROOF and 3W/LMV/TRANS licence', async () => {
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'THREE_WHEELER' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'])
      );
      expect(rules?.allowedLicenceClasses).toEqual(
        expect.arrayContaining(['3W-CAB', 'LMV', 'TRANS'])
      );
    });

    it('should configure TATA_ACE requiring LMV or TRANS licence', async () => {
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'TATA_ACE' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'])
      );
      expect(rules?.allowedLicenceClasses).toEqual(['LMV', 'LMV-TR', 'TRANS']);
      expect(rules?.allowedLicenceClasses).not.toContain('MCWG');
    });

    it('should configure PICKUP_8FT requiring LMV, TRANS or HMV licence', async () => {
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'PICKUP_8FT' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'])
      );
      expect(rules?.allowedLicenceClasses).toEqual(['LMV', 'LMV-TR', 'TRANS', 'HMV']);
    });

    it('should configure CANTER_14FT requiring POLICE_VERIFICATION and Heavy/Transport licence', async () => {
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'CANTER_14FT' });
      expect(rules).toBeDefined();
      expect(rules?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF', 'POLICE_VERIFICATION'])
      );
      expect(rules?.allowedLicenceClasses).toEqual(['TRANS', 'HMV', 'HGMV']);
      expect(rules?.allowedLicenceClasses).not.toContain('LMV');
      expect(rules?.requiresCommercialBadge).toBe(true);
      expect(rules?.requiresPoliceVerification).toBe(true);
    });

    it('should support composite rules (Vehicle Type + Service Category)', async () => {
      policyProvider.setCompositeRule('TATA_ACE', 'HAZMAT', {
        requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'AADHAAR', 'HAZMAT_CERTIFICATE'],
        allowedLicenceClasses: ['TRANS', 'HMV'],
        legalApplicabilityNotes: 'Hazardous cargo transport mandate',
      });

      const hazmatRule = await policyProvider.getRulesForDriver({
        vehicleTypeCode: 'TATA_ACE',
        serviceCategoryCode: 'HAZMAT',
      });

      expect(hazmatRule?.requiredDocumentTypes).toContain('HAZMAT_CERTIFICATE');
      expect(hazmatRule?.allowedLicenceClasses).toEqual(['TRANS', 'HMV']);

      // Regular TATA_ACE without service category remains standard
      const standardRule = await policyProvider.getRulesForDriver({
        vehicleTypeCode: 'TATA_ACE',
      });
      expect(standardRule?.requiredDocumentTypes).not.toContain('HAZMAT_CERTIFICATE');
    });

    it('should support jurisdiction-specific rule overrides', async () => {
      policyProvider.setJurisdictionRule('DELHI', 'TWO_WHEELER', {
        requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'DELHI_POLICE_CLEARANCE'],
        allowedLicenceClasses: ['MCWG', 'LMV'],
        legalApplicabilityNotes: 'Delhi NCT mandatory verification',
      });

      const delhiRule = await policyProvider.getRulesForDriver({
        vehicleTypeCode: 'TWO_WHEELER',
        jurisdiction: 'DELHI',
      });
      expect(delhiRule?.requiredDocumentTypes).toContain('DELHI_POLICE_CLEARANCE');

      const regularRule = await policyProvider.getRulesForDriver({
        vehicleTypeCode: 'TWO_WHEELER',
        jurisdiction: 'MUMBAI',
      });
      expect(regularRule?.requiredDocumentTypes).not.toContain('DELHI_POLICE_CLEARANCE');
    });

    it('should fail closed when rules and default rule are cleared', async () => {
      policyProvider.clearRules();
      const rules = await policyProvider.getRulesForDriver({ vehicleTypeCode: 'TWO_WHEELER' });
      expect(rules).toBeNull();
    });

    it('should throw when setting rules with invalid or empty arguments', () => {
      expect(() => policyProvider.setRule('', {} as any)).toThrow();
      expect(() => policyProvider.setCompositeRule('TWO_WHEELER', '', {} as any)).toThrow();
      expect(() => policyProvider.setJurisdictionRule('', 'TWO_WHEELER', {} as any)).toThrow();
    });
  });

  // ==========================================================================
  // 2. Fail-Closed Security Tests
  // ==========================================================================
  describe('2. Fail-Closed Security Tests', () => {
    it('should fail validation when policy provider is missing or undefined', async () => {
      const service = new DriverKycValidationService(null as any);
      const result = await service.validateForApproval({}, []);
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('Driver KYC policy provider unavailable: Security gate fail-closed');
    });

    it('should fail validation when policy provider throws an unexpected error', async () => {
      const mockProvider: IDriverKycPolicyProvider = {
        getRulesForDriver: jest.fn().mockRejectedValue(new Error('Database connectivity lost')),
      };
      const service = new DriverKycValidationService(mockProvider);
      const result = await service.validateForApproval({}, []);
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('Driver KYC policy retrieval failed: Security gate fail-closed');
    });

    it('should fail validation when policy provider returns null or invalid rule', async () => {
      policyProvider.clearRules(); // Returns null
      const result = await validationService.validateForApproval({}, []);
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('Invalid or missing driver KYC policy specification');
    });
  });

  // ==========================================================================
  // 3. Document Completeness & Optional Document Handling
  // ==========================================================================
  describe('3. Document Completeness & Optional Handling', () => {
    it('should fail validation when mandatory documents are missing', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        [], // No documents uploaded
        { vehicleTypeCode: 'TWO_WHEELER' }
      );

      expect(result.isValid).toBe(false);
      expect(result.missingTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO'])
      );
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'Mandatory driver document missing: DRIVING_LICENCE',
          'Mandatory driver document missing: PROFILE_PHOTO',
        ])
      );
    });

    it('should pass validation when all mandatory documents are verified, even if optional documents are missing', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' } // Optional AADHAAR is missing
      );

      expect(result.isValid).toBe(true);
      expect(result.missingTypes).toHaveLength(0);
      expect(result.unverifiedTypes).toHaveLength(0);
    });

    it('should NOT block validation when an optional document is rejected', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
        {
          documentType: 'AADHAAR', // Optional for TWO_WHEELER
          verificationStatus: 'REJECTED',
          rejectionReason: 'Blurry photo on Aadhaar',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );

      expect(result.isValid).toBe(true);
      expect(result.unverifiedTypes).not.toContain('AADHAAR');
    });

    it('should block validation when a document is made mandatory by a specific vehicle class policy', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
        {
          documentType: 'AADHAAR',
          verificationStatus: 'VERIFIED',
        },
        // POLICE_VERIFICATION is missing
      ];

      // For TATA_ACE, POLICE_VERIFICATION is optional -> passes
      const aceResult = await validationService.validateForApproval(
        { licenceClasses: ['LMV'] },
        docs,
        { vehicleTypeCode: 'TATA_ACE' }
      );
      expect(aceResult.isValid).toBe(true);

      // For CANTER_14FT, POLICE_VERIFICATION is mandatory -> fails
      const canterResult = await validationService.validateForApproval(
        { licenceClasses: ['TRANS'] },
        docs,
        { vehicleTypeCode: 'CANTER_14FT' }
      );
      expect(canterResult.isValid).toBe(false);
      expect(canterResult.missingTypes).toContain('POLICE_VERIFICATION');
    });
  });

  // ==========================================================================
  // 4. Anti-Bypass Gate: Replacement Immutability & Status Precedence
  // ==========================================================================
  describe('4. Anti-Bypass Gate & Document Replacement', () => {
    it('should strictly evaluate ONLY the latest document for each document type', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          id: 1,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );
      expect(result.isValid).toBe(true);
    });

    it('should BLOCK KYC when a replacement document is PENDING (no fallback to older verified document)', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          id: 1,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED', // Old document was verified
          expiryDate: new Date('2030-01-01'),
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'PENDING', // New replacement is pending
          uploadedAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: 3,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );

      // Must fail closed because the latest DRIVING_LICENCE is PENDING
      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('DRIVING_LICENCE');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Mandatory document 'DRIVING_LICENCE' verification is pending"),
        ])
      );
    });

    it('should BLOCK KYC when a replacement document is REJECTED', async () => {
      const docs: DriverDocumentRecord[] = [
        {
          id: 1,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'REJECTED',
          rejectionReason: 'Address mismatch on renewal copy',
          uploadedAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: 3,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );

      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('DRIVING_LICENCE');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Mandatory document 'DRIVING_LICENCE' was rejected: Address mismatch on renewal copy"),
        ])
      );
    });

    it('should use ID as a deterministic tie-breaker when uploadedAt timestamps are identical', async () => {
      const sameTime = new Date('2026-06-01T12:00:00Z');
      const docs: DriverDocumentRecord[] = [
        {
          id: 10,
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2030-01-01'),
          uploadedAt: sameTime,
        },
        {
          id: 11, // Higher ID -> submitted later in transaction
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'PENDING',
          uploadedAt: sameTime,
        },
        {
          id: 12,
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
          uploadedAt: sameTime,
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );

      expect(result.isValid).toBe(false);
      expect(result.unverifiedTypes).toContain('DRIVING_LICENCE');
    });
  });

  // ==========================================================================
  // 5. Asia/Kolkata Calendar Expiry & Warning Semantics
  // ==========================================================================
  describe('5. Asia/Kolkata Calendar Expiry & 15-Day Warning', () => {
    it('should remain VALID throughout its entire expiry calendar day in Asia/Kolkata (until 23:59:59.999 IST)', async () => {
      // Current date is 2026-11-17 15:30:00 IST
      const refDate = new Date('2026-11-17T10:00:00.000Z'); // 15:30 IST

      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: '2026-11-17', // Expires today
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' },
        refDate
      );

      // Remains valid on expiry date itself
      expect(result.isValid).toBe(true);
      expect(result.expiredTypes).toHaveLength(0);
      expect(result.expiringSoonTypes).toContain('DRIVING_LICENCE'); // 0 days remaining, in warning
    });

    it('should become EXPIRED immediately at 00:00:00.000 IST of the next calendar day (zero grace days)', async () => {
      // 00:00:01 IST on 2026-11-18 is 18:30:01 UTC on 2026-11-17
      const nextDayKolkata = new Date('2026-11-17T18:30:01.000Z');

      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: '2026-11-17',
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' },
        nextDayKolkata
      );

      expect(result.isValid).toBe(false);
      expect(result.expiredTypes).toContain('DRIVING_LICENCE');
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Mandatory document 'DRIVING_LICENCE' expired on 2026-11-17 (Asia/Kolkata calendar midnight)"),
        ])
      );
      expect(result.documentWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentType: 'DRIVING_LICENCE',
            warning: 'DOCUMENT_EXPIRED',
          }),
        ])
      );
    });

    it('should flag DOCUMENT_EXPIRING_SOON warning within 15 calendar days without blocking validity', async () => {
      // Reference date: 2026-11-01
      const refDate = new Date('2026-11-01T06:00:00.000Z');

      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: '2026-11-15', // 14 days remaining
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' },
        refDate
      );

      expect(result.isValid).toBe(true);
      expect(result.expiredTypes).toHaveLength(0);
      expect(result.expiringSoonTypes).toContain('DRIVING_LICENCE');
      expect(result.documentWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentType: 'DRIVING_LICENCE',
            warning: 'DOCUMENT_EXPIRING_SOON',
            daysRemaining: 14,
          }),
        ])
      );
    });

    it('should NOT flag warning when document expiry is greater than 15 calendar days away', async () => {
      const refDate = new Date('2026-11-01T06:00:00.000Z');

      const docs: DriverDocumentRecord[] = [
        {
          documentType: 'DRIVING_LICENCE',
          verificationStatus: 'VERIFIED',
          expiryDate: '2026-12-01', // 30 days remaining
        },
        {
          documentType: 'PROFILE_PHOTO',
          verificationStatus: 'VERIFIED',
        },
      ];

      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        docs,
        { vehicleTypeCode: 'TWO_WHEELER' },
        refDate
      );

      expect(result.isValid).toBe(true);
      expect(result.expiringSoonTypes).toHaveLength(0);
      expect(result.documentWarnings).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 6. Licence Class Eligibility Matrix
  // ==========================================================================
  describe('6. Licence Class Compatibility Matrix', () => {
    const validDocs: DriverDocumentRecord[] = [
      {
        documentType: 'DRIVING_LICENCE',
        verificationStatus: 'VERIFIED',
        expiryDate: new Date('2030-01-01'),
      },
      {
        documentType: 'PROFILE_PHOTO',
        verificationStatus: 'VERIFIED',
      },
      {
        documentType: 'AADHAAR',
        verificationStatus: 'VERIFIED',
      },
      {
        documentType: 'POLICE_VERIFICATION',
        verificationStatus: 'VERIFIED',
      },
    ];

    it('should ACCEPT driver with MCWG for TWO_WHEELER', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        validDocs,
        { vehicleTypeCode: 'TWO_WHEELER' }
      );
      expect(result.isValid).toBe(true);
      expect(result.incompatibleLicenceClasses).toHaveLength(0);
    });

    it('should REJECT driver with MCWG only when attempting to drive TATA_ACE (SCV)', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: ['MCWG'] },
        validDocs,
        { vehicleTypeCode: 'TATA_ACE' }
      );
      expect(result.isValid).toBe(false);
      expect(result.incompatibleLicenceClasses).toEqual(['LMV', 'LMV-TR', 'TRANS']);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Driver licence classes [MCWG] are not authorized for vehicle class 'TATA_ACE'"),
        ])
      );
    });

    it('should ACCEPT driver with LMV for TATA_ACE and PICKUP_8FT', async () => {
      const aceResult = await validationService.validateForApproval(
        { licenceClasses: ['LMV'] },
        validDocs,
        { vehicleTypeCode: 'TATA_ACE' }
      );
      expect(aceResult.isValid).toBe(true);

      const pickupResult = await validationService.validateForApproval(
        { licenceClasses: ['LMV'] },
        validDocs,
        { vehicleTypeCode: 'PICKUP_8FT' }
      );
      expect(pickupResult.isValid).toBe(true);
    });

    it('should REJECT driver with LMV only when attempting to drive CANTER_14FT (requires Heavy/Transport)', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: ['LMV'] },
        validDocs,
        { vehicleTypeCode: 'CANTER_14FT' }
      );
      expect(result.isValid).toBe(false);
      expect(result.incompatibleLicenceClasses).toEqual(['TRANS', 'HMV', 'HGMV']);
    });

    it('should ACCEPT driver with TRANS for all commercial vehicle types', async () => {
      const vehicleTypes = ['TWO_WHEELER', 'THREE_WHEELER', 'TATA_ACE', 'PICKUP_8FT', 'CANTER_14FT'];
      for (const vt of vehicleTypes) {
        const res = await validationService.validateForApproval(
          { licenceClasses: ['TRANS'] },
          validDocs,
          { vehicleTypeCode: vt }
        );
        expect(res.isValid).toBe(true);
      }
    });

    it('should handle whitespace and case-insensitivity in licence endorsements', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: ['  mcwg  ', 'lmv '] },
        validDocs,
        { vehicleTypeCode: 'TATA_ACE' }
      );
      expect(result.isValid).toBe(true);
    });

    it('should fail when driver has empty or undefined licence classes and policy mandates allowed classes', async () => {
      const result = await validationService.validateForApproval(
        { licenceClasses: [] },
        validDocs,
        { vehicleTypeCode: 'TATA_ACE' }
      );
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('are not authorized for vehicle class');
    });
  });

  // ==========================================================================
  // 7. Standalone isLicenceEligibleForVehicleClass Helper
  // ==========================================================================
  describe('7. Standalone isLicenceEligibleForVehicleClass', () => {
    it('should correctly evaluate eligibility for TWO_WHEELER', async () => {
      const checkMcwg = await validationService.isLicenceEligibleForVehicleClass(['MCWG'], 'TWO_WHEELER');
      expect(checkMcwg.isEligible).toBe(true);

      const checkNone = await validationService.isLicenceEligibleForVehicleClass([], 'TWO_WHEELER');
      expect(checkNone.isEligible).toBe(false);
    });

    it('should correctly evaluate eligibility for CANTER_14FT', async () => {
      const checkLmv = await validationService.isLicenceEligibleForVehicleClass(['LMV'], 'CANTER_14FT');
      expect(checkLmv.isEligible).toBe(false);
      expect(checkLmv.reason).toContain('do not satisfy required');

      const checkHmv = await validationService.isLicenceEligibleForVehicleClass(['HMV'], 'CANTER_14FT');
      expect(checkHmv.isEligible).toBe(true);
    });

    it('should fail closed when vehicle type does not exist and default rule is cleared', async () => {
      policyProvider.clearRules();
      const res = await validationService.isLicenceEligibleForVehicleClass(['TRANS'], 'NON_EXISTENT_TYPE');
      expect(res.isEligible).toBe(false);
      expect(res.reason).toContain('Security gate fail-closed');
    });
  });

  // ==========================================================================
  // 8. Database Integration via validateDriverWithRepository
  // ==========================================================================
  describe('8. Database Integration via validateDriverWithRepository', () => {
    const profileRepo = new DriverProfileRepository();
    const documentRepo = new DriverDocumentRepository();
    let serviceWithRepo: DriverKycValidationService;

    const TEST_MOBILE = '+919998881234';
    let testUserId: bigint;
    let testDriverId: bigint;

    beforeEach(() => {
      serviceWithRepo = new DriverKycValidationService(policyProvider, documentRepo, profileRepo);
    });

    beforeAll(async () => {
      // Clean up test data if already exists
      const existingUser = await prisma.user.findUnique({ where: { mobileNumber: TEST_MOBILE } });
      if (existingUser) {
        await prisma.driverDocument.deleteMany({ where: { driver: { userId: existingUser.id } } });
        await prisma.driverProfile.deleteMany({ where: { userId: existingUser.id } });
        await prisma.user.delete({ where: { id: existingUser.id } });
      }

      // Create test user and driver profile
      const user = await prisma.user.create({
        data: {
          mobileNumber: TEST_MOBILE,
          isMobileVerified: true,
        },
      });
      testUserId = user.id;

      const profile = await profileRepo.create({
        userId: testUserId,
        firstName: 'Integration',
        lastName: 'Driver',
        licenceNumber: 'DL-MH02-2026-9999',
        licenceClasses: ['LMV', 'TRANS'],
      });
      testDriverId = profile.id;
    });

    afterAll(async () => {
      if (testDriverId) {
        await prisma.driverDocument.deleteMany({ where: { driverId: testDriverId } });
        await prisma.driverProfile.deleteMany({ where: { id: testDriverId } });
      }
      if (testUserId) {
        await prisma.user.deleteMany({ where: { id: testUserId } });
      }
    });

    it('should fail when driver has no documents uploaded in database', async () => {
      const result = await serviceWithRepo.validateDriverWithRepository(testDriverId, {
        vehicleTypeCode: 'TATA_ACE',
      });
      expect(result.isValid).toBe(false);
      expect(result.missingTypes).toEqual(
        expect.arrayContaining(['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'])
      );
    });

    it('should evaluate uploaded database documents with anti-bypass semantics', async () => {
      // 1. Upload initial verified driving licence
      const oldDoc = await documentRepo.create({
        driverId: testDriverId,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: 'drivers/test/dl_v1.pdf',
        verificationStatus: 'VERIFIED',
        expiryDate: new Date('2030-01-01'),
      });

      const photoDoc = await documentRepo.create({
        driverId: testDriverId,
        documentType: 'PROFILE_PHOTO',
        documentStorageKey: 'drivers/test/photo_v1.jpg',
        verificationStatus: 'VERIFIED',
      });

      const identityDoc = await documentRepo.create({
        driverId: testDriverId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'drivers/test/identity_v1.pdf',
        verificationStatus: 'VERIFIED',
      });

      // All verified -> passes
      let evalResult = await serviceWithRepo.validateDriverWithRepository(testDriverId, {
        vehicleTypeCode: 'TATA_ACE',
      });
      expect(evalResult.isValid).toBe(true);

      // 2. Upload replacement driving licence in PENDING status
      const replacementDoc = await documentRepo.create({
        driverId: testDriverId,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: 'drivers/test/dl_v2_replacement.pdf',
        verificationStatus: 'PENDING',
        expiryDate: new Date('2035-01-01'),
      });

      // Must fail closed because replacement is PENDING
      evalResult = await serviceWithRepo.validateDriverWithRepository(testDriverId, {
        vehicleTypeCode: 'TATA_ACE',
      });
      expect(evalResult.isValid).toBe(false);
      expect(evalResult.unverifiedTypes).toContain('DRIVING_LICENCE');

      // 3. Admin verifies replacement document
      await documentRepo.updateVerificationStatus(replacementDoc.id, {
        verificationStatus: 'VERIFIED',
        reviewedBy: testUserId,
        reviewedAt: new Date(),
      });

      // Now passes again
      evalResult = await serviceWithRepo.validateDriverWithRepository(testDriverId, {
        vehicleTypeCode: 'TATA_ACE',
      });
      expect(evalResult.isValid).toBe(true);
    });

    it('should return not found result if driver profile does not exist', async () => {
      const nonExistentId = 9999999999n;
      const result = await serviceWithRepo.validateDriverWithRepository(nonExistentId);
      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toContain('not found');
    });
  });
});
