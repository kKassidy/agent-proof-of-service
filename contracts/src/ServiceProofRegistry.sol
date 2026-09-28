// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Records trusted payment confirmations and immutable service outcomes.
contract ServiceProofRegistry {
    enum Status {
        Created,
        Paid,
        Success,
        Failure
    }

    struct Job {
        address buyer;
        address seller;
        bytes32 taskHash;
        bytes32 paymentRef;
        bytes32 resultHash;
        uint64 createdAt;
        uint64 completedAt;
        Status status;
    }

    struct SellerStats {
        uint256 paidJobs;
        uint256 successfulJobs;
        uint256 failedJobs;
    }

    error Unauthorized();
    error ZeroAddress();
    error ZeroHash();
    error JobNotFound();
    error InvalidState();
    error InvalidOutcome();
    error PaymentReferenceAlreadyUsed();

    event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed seller, bytes32 taskHash);
    event PaymentConfirmed(uint256 indexed jobId, bytes32 paymentRef);
    event OutcomeRecorded(uint256 indexed jobId, Status outcome, bytes32 resultHash);
    event PaymentConfirmerChanged(address indexed previousConfirmer, address indexed newConfirmer);
    event ValidatorChanged(address indexed previousValidator, address indexed newValidator);

    address public immutable owner;
    address public paymentConfirmer;
    address public validator;
    uint256 public jobCount;
    mapping(uint256 => Job) private _jobs;
    mapping(address => SellerStats) public sellerStats;
    mapping(bytes32 => bool) private _consumedPaymentRefs;

    constructor() {
        owner = msg.sender;
    }

    function setPaymentConfirmer(address newConfirmer) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newConfirmer == address(0)) revert ZeroAddress();
        address previousConfirmer = paymentConfirmer;
        paymentConfirmer = newConfirmer;
        emit PaymentConfirmerChanged(previousConfirmer, newConfirmer);
    }

    function setValidator(address newValidator) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newValidator == address(0)) revert ZeroAddress();
        address previousValidator = validator;
        validator = newValidator;
        emit ValidatorChanged(previousValidator, newValidator);
    }

    function createJob(address seller, bytes32 taskHash) external returns (uint256 jobId) {
        if (seller == address(0)) revert ZeroAddress();
        if (taskHash == bytes32(0)) revert ZeroHash();
        jobId = ++jobCount;
        _jobs[jobId] = Job({
            buyer: msg.sender,
            seller: seller,
            taskHash: taskHash,
            paymentRef: bytes32(0),
            resultHash: bytes32(0),
            // Unix timestamps fit uint64 for over 584 billion years.
            // forge-lint: disable-next-line(unsafe-typecast)
            createdAt: uint64(block.timestamp),
            completedAt: 0,
            status: Status.Created
        });
        emit JobCreated(jobId, msg.sender, seller, taskHash);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _existingJob(jobId);
    }

    function confirmPayment(uint256 jobId, bytes32 paymentRef) external {
        if (msg.sender != paymentConfirmer) revert Unauthorized();
        Job storage job = _existingJob(jobId);
        if (job.status != Status.Created) revert InvalidState();
        if (paymentRef == bytes32(0)) revert ZeroHash();
        if (_consumedPaymentRefs[paymentRef]) revert PaymentReferenceAlreadyUsed();
        _consumedPaymentRefs[paymentRef] = true;
        job.paymentRef = paymentRef;
        job.status = Status.Paid;
        sellerStats[job.seller].paidJobs++;
        emit PaymentConfirmed(jobId, paymentRef);
    }

    function recordOutcome(uint256 jobId, Status outcome, bytes32 resultHash) external {
        if (msg.sender != validator) revert Unauthorized();
        Job storage job = _existingJob(jobId);
        if (job.status != Status.Paid) revert InvalidState();
        if (outcome != Status.Success && outcome != Status.Failure) revert InvalidOutcome();
        if (resultHash == bytes32(0)) revert ZeroHash();
        job.status = outcome;
        job.resultHash = resultHash;
        // Unix timestamps fit uint64 for over 584 billion years.
        // forge-lint: disable-next-line(unsafe-typecast)
        job.completedAt = uint64(block.timestamp);
        if (outcome == Status.Success) {
            sellerStats[job.seller].successfulJobs++;
        } else {
            sellerStats[job.seller].failedJobs++;
        }
        emit OutcomeRecorded(jobId, outcome, resultHash);
    }

    function _existingJob(uint256 jobId) private view returns (Job storage job) {
        if (jobId == 0 || jobId > jobCount) revert JobNotFound();
        return _jobs[jobId];
    }
}
