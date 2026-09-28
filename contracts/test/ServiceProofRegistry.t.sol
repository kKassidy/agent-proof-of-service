// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ServiceProofRegistry as Registry} from "../src/ServiceProofRegistry.sol";

contract ServiceProofRegistryTest is Test {
    Registry internal registry;
    address internal buyer = address(0xB1);
    address internal seller = address(0x51);
    address internal confirmer = address(0xC1);
    address internal validator = address(0xA1);
    bytes32 internal constant TASK = keccak256("task");
    bytes32 internal constant PAYMENT = keccak256("payment");
    bytes32 internal constant RESULT = keccak256("result");

    function setUp() public {
        vm.warp(1000);
        registry = new Registry();
        registry.setPaymentConfirmer(confirmer);
        registry.setValidator(validator);
    }

    function _create(address jobSeller) internal returns (uint256) {
        vm.prank(buyer);
        return registry.createJob(jobSeller, TASK);
    }

    function _pay(uint256 id) internal {
        _pay(id, PAYMENT);
    }

    function _pay(uint256 id, bytes32 paymentRef) internal {
        vm.prank(confirmer);
        registry.confirmPayment(id, paymentRef);
    }

    function _finish(uint256 id, Registry.Status outcome) internal {
        vm.prank(validator);
        registry.recordOutcome(id, outcome, RESULT);
    }

    function _stats(address who, uint256 paid, uint256 success, uint256 failure) internal view {
        (uint256 p, uint256 s, uint256 f) = registry.sellerStats(who);
        assertEq(p, paid);
        assertEq(s, success);
        assertEq(f, failure);
    }

    function test_InitialConfiguration() public {
        Registry fresh = new Registry();
        assertEq(fresh.owner(), address(this));
        assertEq(fresh.paymentConfirmer(), address(0));
        assertEq(fresh.validator(), address(0));
        assertEq(fresh.jobCount(), 0);
    }

    function test_UnconfiguredRolesRejectCalls() public {
        Registry fresh = new Registry();
        uint256 id = fresh.createJob(seller, TASK);
        vm.expectRevert(Registry.Unauthorized.selector);
        fresh.confirmPayment(id, PAYMENT);
        vm.expectRevert(Registry.Unauthorized.selector);
        fresh.recordOutcome(id, Registry.Status.Success, RESULT);
    }

    function test_CreateJob() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit Registry.JobCreated(1, buyer, seller, TASK);
        uint256 id = _create(seller);
        assertEq(id, 1);
        Registry.Job memory job = registry.getJob(id);
        assertEq(job.buyer, buyer);
        assertEq(job.seller, seller);
        assertEq(job.taskHash, TASK);
        assertEq(job.paymentRef, bytes32(0));
        assertEq(job.resultHash, bytes32(0));
        assertEq(job.createdAt, 1000);
        assertEq(job.completedAt, 0);
        assertEq(uint256(job.status), uint256(Registry.Status.Created));
        _stats(seller, 0, 0, 0);
    }

    function test_UniqueSequentialIds() public {
        assertEq(_create(seller), 1);
        assertEq(_create(seller), 2);
        assertEq(registry.jobCount(), 2);
        assertEq(registry.getJob(1).taskHash, TASK);
    }

    function test_RejectZeroSeller() public {
        vm.expectRevert(Registry.ZeroAddress.selector);
        registry.createJob(address(0), TASK);
        assertEq(registry.jobCount(), 0);
    }

    function test_RejectZeroTaskHash() public {
        vm.expectRevert(Registry.ZeroHash.selector);
        registry.createJob(seller, bytes32(0));
        assertEq(registry.jobCount(), 0);
    }

    function test_ConfirmPayment() public {
        uint256 id = _create(seller);
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.PaymentConfirmed(id, PAYMENT);
        _pay(id);
        Registry.Job memory job = registry.getJob(id);
        assertEq(uint256(job.status), uint256(Registry.Status.Paid));
        assertEq(job.paymentRef, PAYMENT);
        assertEq(job.resultHash, bytes32(0));
        assertEq(job.completedAt, 0);
        _stats(seller, 1, 0, 0);
    }

    function testFuzz_UnauthorizedPaymentConfirmation(address caller) public {
        vm.assume(caller != confirmer);
        uint256 id = _create(seller);
        vm.prank(caller);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.confirmPayment(id, PAYMENT);
        assertEq(uint256(registry.getJob(id).status), uint256(Registry.Status.Created));
        _stats(seller, 0, 0, 0);
        _pay(id);
        assertEq(registry.getJob(id).paymentRef, PAYMENT);
        _stats(seller, 1, 0, 0);
    }

    function test_RejectPaymentReferenceReuseAcrossJobs() public {
        uint256 first = _create(seller);
        address otherSeller = address(0x52);
        vm.prank(address(0xB2));
        uint256 second = registry.createJob(otherSeller, TASK);
        _pay(first);

        vm.expectRevert(Registry.PaymentReferenceAlreadyUsed.selector);
        _pay(second);

        assertEq(uint256(registry.getJob(first).status), uint256(Registry.Status.Paid));
        assertEq(registry.getJob(first).paymentRef, PAYMENT);
        assertEq(uint256(registry.getJob(second).status), uint256(Registry.Status.Created));
        assertEq(registry.getJob(second).paymentRef, bytes32(0));
        _stats(seller, 1, 0, 0);
        _stats(otherSeller, 0, 0, 0);
    }

    function test_FailedConfirmationDoesNotConsumePaymentReference() public {
        uint256 first = _create(seller);
        uint256 second = _create(seller);
        bytes32 otherPayment = keccak256("other payment");
        _pay(first);

        vm.expectRevert(Registry.JobNotFound.selector);
        _pay(0, otherPayment);
        vm.expectRevert(Registry.InvalidState.selector);
        _pay(first, otherPayment);

        _pay(second, otherPayment);
        assertEq(registry.getJob(second).paymentRef, otherPayment);
        assertEq(uint256(registry.getJob(second).status), uint256(Registry.Status.Paid));
        _stats(seller, 2, 0, 0);
    }

    function test_DifferentPaymentReferencesConfirmDifferentJobs() public {
        uint256 first = _create(seller);
        uint256 second = _create(seller);
        bytes32 otherPayment = keccak256("other payment");
        _pay(first);
        _pay(second, otherPayment);

        assertEq(registry.getJob(first).paymentRef, PAYMENT);
        assertEq(registry.getJob(second).paymentRef, otherPayment);
        assertEq(uint256(registry.getJob(first).status), uint256(Registry.Status.Paid));
        assertEq(uint256(registry.getJob(second).status), uint256(Registry.Status.Paid));
        _stats(seller, 2, 0, 0);
    }

    function test_RejectZeroPaymentReference() public {
        uint256 id = _create(seller);
        vm.prank(confirmer);
        vm.expectRevert(Registry.ZeroHash.selector);
        registry.confirmPayment(id, bytes32(0));
        _stats(seller, 0, 0, 0);
        _pay(id);
    }

    function test_RejectPaymentReconfirmationWhilePaid() public {
        uint256 id = _create(seller);
        _pay(id);
        vm.prank(confirmer);
        vm.expectRevert(Registry.InvalidState.selector);
        registry.confirmPayment(id, keccak256("different payment"));
        assertEq(registry.getJob(id).paymentRef, PAYMENT);
        _stats(seller, 1, 0, 0);
    }

    function _checkFinalization(Registry.Status outcome) internal {
        uint256 id = _create(seller);
        _pay(id);
        vm.warp(2000);
        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.OutcomeRecorded(id, outcome, RESULT);
        _finish(id, outcome);
        Registry.Job memory job = registry.getJob(id);
        assertEq(uint256(job.status), uint256(outcome));
        assertEq(job.buyer, buyer);
        assertEq(job.seller, seller);
        assertEq(job.taskHash, TASK);
        assertEq(job.paymentRef, PAYMENT);
        assertEq(job.resultHash, RESULT);
        assertEq(job.createdAt, 1000);
        assertEq(job.completedAt, 2000);
    }

    function test_SuccessFinalization() public {
        _checkFinalization(Registry.Status.Success);
        _stats(seller, 1, 1, 0);
    }

    function test_FailureFinalization() public {
        _checkFinalization(Registry.Status.Failure);
        _stats(seller, 1, 0, 1);
    }

    function testFuzz_UnauthorizedValidator(address caller) public {
        vm.assume(caller != validator);
        uint256 id = _create(seller);
        _pay(id);
        vm.prank(caller);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordOutcome(id, Registry.Status.Success, RESULT);
        assertEq(uint256(registry.getJob(id).status), uint256(Registry.Status.Paid));
        _stats(seller, 1, 0, 0);
    }

    function testFuzz_OutcomeBeforePayment(bool success) public {
        uint256 id = _create(seller);
        vm.prank(validator);
        vm.expectRevert(Registry.InvalidState.selector);
        registry.recordOutcome(id, success ? Registry.Status.Success : Registry.Status.Failure, RESULT);
        _stats(seller, 0, 0, 0);
    }

    function testFuzz_InvalidFinalStatus(bool paid) public {
        uint256 id = _create(seller);
        _pay(id);
        vm.prank(validator);
        vm.expectRevert(Registry.InvalidOutcome.selector);
        registry.recordOutcome(id, paid ? Registry.Status.Paid : Registry.Status.Created, RESULT);
        _stats(seller, 1, 0, 0);
    }

    function test_InvalidEnumEncoding() public {
        uint256 id = _create(seller);
        _pay(id);
        vm.prank(validator);
        (bool ok,) =
            address(registry).call(abi.encodeWithSelector(registry.recordOutcome.selector, id, uint8(4), RESULT));
        assertFalse(ok);
        assertEq(uint256(registry.getJob(id).status), uint256(Registry.Status.Paid));
    }

    function testFuzz_ZeroResultHash(bool success) public {
        uint256 id = _create(seller);
        _pay(id);
        vm.prank(validator);
        vm.expectRevert(Registry.ZeroHash.selector);
        registry.recordOutcome(id, success ? Registry.Status.Success : Registry.Status.Failure, bytes32(0));
        assertEq(registry.getJob(id).completedAt, 0);
        _stats(seller, 1, 0, 0);
        _finish(id, Registry.Status.Success);
    }

    function testFuzz_FinalOutcomeImmutable(bool firstSuccess, bool secondSuccess) public {
        uint256 id = _create(seller);
        _pay(id);
        Registry.Status first = firstSuccess ? Registry.Status.Success : Registry.Status.Failure;
        _finish(id, first);
        bytes32 beforeHash = keccak256(abi.encode(registry.getJob(id)));
        vm.warp(3000);
        vm.prank(validator);
        vm.expectRevert(Registry.InvalidState.selector);
        registry.recordOutcome(id, secondSuccess ? Registry.Status.Success : Registry.Status.Failure, keccak256("new"));
        vm.prank(confirmer);
        vm.expectRevert(Registry.InvalidState.selector);
        registry.confirmPayment(id, keccak256("new payment"));
        assertEq(keccak256(abi.encode(registry.getJob(id))), beforeHash);
        _stats(seller, 1, firstSuccess ? 1 : 0, firstSuccess ? 0 : 1);
    }

    function test_SellerStatisticsAcrossStates() public {
        uint256 success = _create(seller);
        uint256 failure = _create(seller);
        uint256 paid = _create(seller);
        _create(seller);
        _pay(success);
        _pay(failure, keccak256("failure payment"));
        _pay(paid, keccak256("paid payment"));
        _stats(seller, 3, 0, 0);
        _finish(success, Registry.Status.Success);
        _finish(failure, Registry.Status.Failure);
        _stats(seller, 3, 1, 1);
    }

    function test_IndependentSellerStatistics() public {
        address otherSeller = address(0x52);
        uint256 a = _create(seller);
        uint256 b = _create(otherSeller);
        _pay(a);
        _pay(b, keccak256("other seller payment"));
        _finish(a, Registry.Status.Success);
        _finish(b, Registry.Status.Failure);
        _stats(seller, 1, 1, 0);
        _stats(otherSeller, 1, 0, 1);
        _stats(buyer, 0, 0, 0);
    }

    function testFuzz_OnlyOwnerConfiguresRoles(address caller) public {
        vm.assume(caller != address(this));
        vm.startPrank(caller);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setPaymentConfirmer(caller);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setValidator(caller);
        vm.stopPrank();
        assertEq(registry.paymentConfirmer(), confirmer);
        assertEq(registry.validator(), validator);
    }

    function test_RejectZeroRoleAddresses() public {
        vm.expectRevert(Registry.ZeroAddress.selector);
        registry.setPaymentConfirmer(address(0));
        vm.expectRevert(Registry.ZeroAddress.selector);
        registry.setValidator(address(0));
        assertEq(registry.paymentConfirmer(), confirmer);
        assertEq(registry.validator(), validator);
    }

    function test_RotatePaymentConfirmer() public {
        uint256 id = _create(seller);
        address replacement = address(0xC2);
        vm.expectEmit(true, true, false, true, address(registry));
        emit Registry.PaymentConfirmerChanged(confirmer, replacement);
        registry.setPaymentConfirmer(replacement);
        assertEq(registry.paymentConfirmer(), replacement);
        vm.prank(confirmer);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.confirmPayment(id, PAYMENT);
        vm.prank(replacement);
        registry.confirmPayment(id, PAYMENT);
        _stats(seller, 1, 0, 0);
    }

    function test_RotateValidator() public {
        uint256 id = _create(seller);
        _pay(id);
        address replacement = address(0xA2);
        vm.expectEmit(true, true, false, true, address(registry));
        emit Registry.ValidatorChanged(validator, replacement);
        registry.setValidator(replacement);
        assertEq(registry.validator(), replacement);
        vm.prank(validator);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordOutcome(id, Registry.Status.Success, RESULT);
        vm.prank(replacement);
        registry.recordOutcome(id, Registry.Status.Success, RESULT);
        _stats(seller, 1, 1, 0);
    }

    function _missing(uint256 id) internal {
        vm.expectRevert(Registry.JobNotFound.selector);
        registry.getJob(id);
        vm.prank(confirmer);
        vm.expectRevert(Registry.JobNotFound.selector);
        registry.confirmPayment(id, PAYMENT);
        vm.prank(validator);
        vm.expectRevert(Registry.JobNotFound.selector);
        registry.recordOutcome(id, Registry.Status.Success, RESULT);
        _stats(seller, 0, 0, 0);
    }

    function test_ZeroJobIdDoesNotExist() public {
        _create(seller);
        _missing(0);
    }

    function testFuzz_NonexistentJob(uint256 id) public {
        _create(seller);
        id = bound(id, 2, type(uint256).max);
        _missing(id);
    }
}
