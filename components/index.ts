/**
 * BARREL EXPORTS
 * 
 * Simplifies imports across the app
 */

// UI Components
export { FailedTransactionBadge, FailedTransactionCard } from './ui/FailedTransactionCard';
export { SupportEmailButton } from './ui/SupportEmailButton';
export { SwipeToConfirm } from './ui/SwipeToConfirm';


// Onramp Components
export { APIGuestCheckoutWidget } from './onramp/APIGuestCheckoutWidget';
export { OnrampForm } from './onramp/OnrampForm';

// Hooks
export { useOnramp } from '../hooks/useOnramp';

// Utils
export { createGuestCheckoutOrder } from '../utils/createGuestCheckoutOrder';
export { fetchBuyOptions } from '../utils/fetchBuyOptions';
export { fetchTransactionHistory } from '../utils/fetchTransactionHistory';
export {
  createDebugInfoFromTransaction,
  createGuestCheckoutDebugInfo, openSupportEmail, SUPPORT_EMAIL
} from '../utils/supportEmail';

// Types
export type { OnrampFormData } from './onramp/OnrampForm';
