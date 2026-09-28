// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ServiceProofRegistry} from "../src/ServiceProofRegistry.sol";

contract DeployServiceProofRegistry is Script {
    function run() external returns (ServiceProofRegistry registry) {
        address paymentConfirmer = vm.envAddress("PAYMENT_CONFIRMER_ADDRESS");
        address validator = vm.envAddress("VALIDATOR_ADDRESS");
        require(paymentConfirmer != address(0), "PAYMENT_CONFIRMER_ADDRESS is zero");
        require(validator != address(0), "VALIDATOR_ADDRESS is zero");

        vm.startBroadcast();
        registry = new ServiceProofRegistry();
        registry.setPaymentConfirmer(paymentConfirmer);
        registry.setValidator(validator);
        vm.stopBroadcast();

        console2.log("ServiceProofRegistry:", address(registry));
        console2.log("paymentConfirmer:", paymentConfirmer);
        console2.log("validator:", validator);
    }
}
