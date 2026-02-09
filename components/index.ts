/**
 * BARREL EXPORTS
 * 
 * Simplifies imports across the app
 */

// UI Components
export { SwipeToConfirm } from './ui/SwipeToConfirm';
export { SupportEmailButton } from './ui/SupportEmailButton';
export { FailedTransactionCard, FailedTransactionBadge } from './ui/FailedTransactionCard';


// Onramp Components
export { ApplePayWidget } from './onramp/ApplePayWidget';
export { OnrampForm } from './onramp/OnrampForm';

// Hooks
export { useOnramp } from '../hooks/useOnramp';

// Utils
export { createApplePayOrder } from '../utils/createApplePayOrder';
export { fetchBuyOptions } from '../utils/fetchBuyOptions';
export { fetchTransactionHistory } from '../utils/fetchTransactionHistory';
export {
  openSupportEmail,
  createDebugInfoFromTransaction,
  createGuestCheckoutDebugInfo,
  SUPPORT_EMAIL
} from '../utils/supportEmail';

// Types
export type { OnrampFormData } from './onramp/OnrampForm';
