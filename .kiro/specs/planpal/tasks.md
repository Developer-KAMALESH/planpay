# Implementation Plan: PLANPAL Enhancements

## Overview

This implementation plan focuses on adding OCR invoice processing capabilities to the existing PLANPAL system and setting up forever-free hosting with Supabase. The current system already has comprehensive expense tracking, Telegram bot integration, and web interface functionality.

## Tasks

- [x] 1. Set up OCR invoice processing infrastructure
  - Install and configure Tesseract.js for image processing
  - Create OCR service module with text extraction and parsing capabilities
  - Implement currency pattern matching for ₹, INR, and Rs. formats
  - _Requirements: 10.5, 10.6_

- [ ]* 1.1 Write property test for OCR text extraction
  - **Property 8: OCR Processing and Integration**
  - **Validates: Requirements 10.1, 10.2**

- [x] 2. Implement Telegram bot image processing with manual fallback
  - [x] 2.1 Add photo message handler to bot.ts
    - Handle photo uploads with `/addexpense` command in caption
    - Download and process images from Telegram file API
    - Extract mentions and description from photo captions
    - _Requirements: 10.1, 10.10_

  - [x] 2.2 Integrate OCR with expense creation workflow
    - Parse OCR results to extract amount and description
    - Create expenses with OCR-extracted data and mentioned participants
    - Implement confidence threshold checking for OCR results
    - _Requirements: 10.2, 10.3, 10.9_

  - [x] 2.3 Implement manual entry fallback system
    - Create conversation state management for multi-step manual entry
    - Implement interactive prompts for amount, description, and participant confirmation
    - Handle user responses during manual entry workflow
    - Preserve mentioned participants from original image command
    - _Requirements: 10.5, 10.6, 10.7, 10.12_

  - [x] 2.4 Add OCR confidence validation and fallback triggers
    - Check OCR result confidence scores and text clarity
    - Automatically trigger manual entry for unclear images
    - Provide helpful feedback about why manual entry is needed
    - _Requirements: 10.4, 10.5, 10.11_

  - [ ]* 2.5 Write property tests for image processing and manual fallback workflow
    - **Property 8: OCR Processing and Manual Fallback Integration**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6, 10.7, 10.12**

- [x] 3. Enhance error handling and user feedback for OCR and manual entry
  - [x] 3.1 Implement OCR confidence validation and user guidance
    - Check OCR result confidence scores and image quality indicators
    - Provide helpful error messages for poor image quality
    - Guide users on improving image capture techniques
    - Automatically suggest manual entry for unclear images
    - _Requirements: 10.11_

  - [x] 3.2 Add comprehensive OCR and manual entry status feedback
    - Show processing status messages to users during OCR
    - Display extracted details for user confirmation before expense creation
    - Provide clear instructions during manual entry workflow
    - Handle timeout scenarios for large image processing
    - _Requirements: 10.10, 10.12_

  - [x] 3.3 Implement conversation state management
    - Track user conversation state during manual entry process
    - Handle conversation timeouts and cleanup
    - Allow users to cancel manual entry process
    - Provide help commands during manual entry workflow
    - _Requirements: 10.12_

- [ ]* 3.4 Write unit tests for error handling and manual entry scenarios
  - Test poor image quality handling and automatic fallback
  - Test conversation state management and timeouts
  - Test manual entry workflow completion and cancellation
  - _Requirements: 10.11, 10.12_

- [x] 4. Set up Supabase database migration
  - [x] 4.1 Create Supabase project and configure database
    - Set up free Supabase account and project
    - Configure PostgreSQL database with proper settings
    - Set up connection pooling and security rules
    - _Requirements: 8.1, 8.7_

  - [x] 4.2 Migrate existing data to Supabase
    - Export current PostgreSQL data using pg_dump
    - Import data to Supabase using SQL editor or CLI
    - Verify data integrity and relationships after migration
    - _Requirements: 8.1, 8.6_

  - [x] 4.3 Update application configuration for Supabase
    - Update DATABASE_URL environment variable
    - Configure Drizzle ORM for Supabase connection
    - Test database connectivity and operations
    - _Requirements: 8.1, 8.3_

- [ ]* 4.4 Write integration tests for Supabase connectivity
  - Test database operations with Supabase
  - Verify session storage functionality
  - _Requirements: 8.1, 8.7_

- [x] 5. Deploy to forever-free hosting stack
  - [x] 5.1 Set up Vercel deployment for frontend
    - Configure Vercel project with GitHub integration
    - Set up build configuration for React application
    - Configure environment variables for production
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Deploy backend to Render free tier
    - Create Render web service for Express.js backend
    - Configure build and start commands for production
    - Set up environment variables including Supabase connection
    - _Requirements: 8.1, 8.3_

  - [x] 5.3 Configure Telegram bot webhook for production
    - Set up webhook URL pointing to Render backend
    - Configure bot token and webhook security
    - Test bot functionality in production environment
    - _Requirements: 2.1, 2.2_

- [x] 6. Checkpoint - Verify OCR and hosting functionality
  - Test OCR invoice processing end-to-end
  - Verify all existing functionality works on new hosting
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add missing expense approval workflow (Optional Enhancement)
  - [x] 7.1 Implement expense voting commands
    - Add `/approve` and `/reject` commands for pending expenses
    - Update expense status based on voting results
    - Implement majority consensus logic for expense approval
    - _Requirements: 3.4, 3.5_

  - [ ]* 7.2 Write property tests for voting workflow
    - **Property 4: Expense Creation and Status Management**
    - **Validates: Requirements 3.3, 3.4**

  - [x] 7.3 Add web interface for expense approval
    - Create expense approval UI in event details page
    - Allow users to approve/reject expenses via web interface
    - Sync approval status between web and Telegram interfaces
    - _Requirements: 1.5, 3.4_

- [ ]* 7.4 Write integration tests for approval workflow
  - Test web and Telegram approval integration
  - Test consensus calculation logic
  - _Requirements: 3.4, 8.3_

- [x] 8. Performance optimization and monitoring
  - [x] 8.1 Optimize OCR processing performance
    - Implement image preprocessing for better OCR accuracy
    - Add image size limits and compression
    - Cache OCR results for duplicate images
    - _Requirements: 10.1, 10.2_

  - [x] 8.2 Add basic monitoring and logging
    - Implement structured logging for debugging
    - Add performance metrics for OCR processing
    - Monitor database query performance
    - _Requirements: 8.2, 9.7_

- [ ]* 8.3 Write performance tests for OCR processing
  - Test OCR processing time limits
  - Test system behavior under concurrent OCR requests
  - _Requirements: 10.1, 8.4_

- [x] 9. Final checkpoint and documentation
  - Ensure all tests pass and functionality works correctly
  - Update README with new OCR features and deployment instructions
  - Verify forever-free hosting setup is working properly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation of new features
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The OCR feature uses Tesseract.js for 100% free processing
- Supabase provides forever-free PostgreSQL hosting
- Existing functionality should remain unchanged during enhancements