import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import OnboardingTour, { RESPONSAVEL_TOUR_STEPS } from './OnboardingTour';
import type { AuthUser } from '../types';

declare global {
  interface Window {
    startTourManual?: () => Promise<void>;
  }
}

interface PortalOnboardingManagerProps {
  authUser: AuthUser | null;
  authLoading: boolean;
  currentTab: 'dashboard' | 'linking' | 'profile';
  onUserChange: Dispatch<SetStateAction<AuthUser | null>>;
}

export default function PortalOnboardingManager({
  authUser,
  authLoading,
  currentTab,
  onUserChange,
}: PortalOnboardingManagerProps) {
  const [showTour, setShowTour] = useState(false);
  const tourEvaluatedRef = useRef(false);

  useEffect(() => {
    if (tourEvaluatedRef.current || !authUser || authLoading || currentTab !== 'dashboard') return;

    if (authUser.tutorialResponsavelConcluido === true) {
      tourEvaluatedRef.current = true;
      setShowTour(false);
      return;
    }

    if (!authUser.profileCompleted) return;

    tourEvaluatedRef.current = true;
    setShowTour(true);
  }, [authLoading, authUser, currentTab]);

  const handleTourFinished = useCallback(() => {
    setShowTour(false);
    onUserChange((user) => (user ? { ...user, tutorialResponsavelConcluido: true } : user));
  }, [onUserChange]);

  useEffect(() => {
    window.startTourManual = async () => {
      tourEvaluatedRef.current = false;
      onUserChange((user) => (user ? { ...user, tutorialResponsavelConcluido: false } : user));
      setShowTour(true);
    };

    return () => {
      delete window.startTourManual;
    };
  }, [onUserChange]);

  if (!showTour || authUser?.tutorialResponsavelConcluido === true) return null;

  return (
    <OnboardingTour
      steps={RESPONSAVEL_TOUR_STEPS}
      onComplete={handleTourFinished}
      onSkip={handleTourFinished}
    />
  );
}