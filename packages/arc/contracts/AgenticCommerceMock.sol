// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * STANDALONE ERC-8183 Agentic Commerce kernel (no OZ imports — compiles via solc-js).
 * Implements the six-state machine + escrow per EIP-8183 (draft, 2026-02-25):
 * Open → Funded → Submitted → Completed | Rejected | Expired.
 * Simplified vs the reference: no UUPS/access-control/fees — hackathon-minimal.
 * Payment token: Arc native USDC (18 decimals on Arc).
 */

interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract AgenticCommerceMock {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    address public paymentToken;
    address public platformTreasury;
    mapping(uint256 => Job) public jobs;
    mapping(address => bool) public whitelistedHooks;
    uint256 public jobCounter;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook);
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ZeroAddress();
    error ZeroBudget();
    error ProviderNotSet();

    modifier onlyStatus(uint256 jobId, JobStatus s) {
        if (jobs[jobId].status != s) revert WrongStatus();
        _;
    }

    constructor(address paymentToken_) {
        paymentToken = paymentToken_;
        platformTreasury = msg.sender;
        whitelistedHooks[address(0)] = true;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp) revert WrongStatus();
        if (hook != address(0) && !whitelistedHooks[hook]) revert Unauthorized();
        jobId = ++jobCounter;
        jobs[jobId] = Job(jobId, msg.sender, provider, evaluator, description, 0, expiredAt, JobStatus.Open, hook);
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
    }

    function setProvider(uint256 jobId, address provider) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Open || j.provider != address(0)) revert WrongStatus();
        if (msg.sender != j.client) revert Unauthorized();
        j.provider = provider;
        emit ProviderSet(jobId, provider);
    }

    function setBudget(uint256 jobId, uint256 amount) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != j.client && msg.sender != j.provider) revert Unauthorized();
        j.budget = amount;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, bytes calldata) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != j.client) revert Unauthorized();
        if (j.provider == address(0)) revert ProviderNotSet();
        if (j.budget == 0) revert ZeroBudget();
        j.status = JobStatus.Funded;
        IERC20(paymentToken).transferFrom(msg.sender, address(this), j.budget);
        emit JobFunded(jobId, msg.sender, j.budget);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Funded) revert WrongStatus();
        if (msg.sender != j.provider) revert Unauthorized();
        j.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, j.provider, deliverable);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != j.evaluator) revert Unauthorized();
        j.status = JobStatus.Completed;
        IERC20(paymentToken).transfer(j.provider, j.budget);
        emit JobCompleted(jobId, j.evaluator, reason);
        emit PaymentReleased(jobId, j.provider, j.budget);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata) external {
        Job storage j = jobs[jobId];
        if (j.status == JobStatus.Open) {
            if (msg.sender != j.client) revert Unauthorized();
        } else if (j.status == JobStatus.Funded || j.status == JobStatus.Submitted) {
            if (msg.sender != j.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }
        j.status = JobStatus.Rejected;
        if (j.budget > 0) {
            IERC20(paymentToken).transfer(j.client, j.budget);
            emit Refunded(jobId, j.client, j.budget);
        }
        emit JobRejected(jobId, msg.sender, reason);
    }

    function claimRefund(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Funded && j.status != JobStatus.Submitted) revert WrongStatus();
        if (block.timestamp < j.expiredAt) revert WrongStatus();
        j.status = JobStatus.Expired;
        if (j.budget > 0) {
            IERC20(paymentToken).transfer(j.client, j.budget);
            emit Refunded(jobId, j.client, j.budget);
        }
        emit JobExpired(jobId);
    }

    function getJob(uint256 jobId)
        external
        view
        returns (
            uint256 id,
            address client,
            address provider,
            address evaluator,
            string memory description,
            uint256 budget,
            uint256 expiredAt,
            uint8 status,
            address hook
        )
    {
        Job storage j = jobs[jobId];
        return (j.id, j.client, j.provider, j.evaluator, j.description, j.budget, j.expiredAt, uint8(j.status), j.hook);
    }

    function setHookWhitelist(address hook, bool status_) external {
        whitelistedHooks[hook] = status_;
    }
}
